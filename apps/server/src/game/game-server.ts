import { SharedChests } from './chests';
import { animatedBore } from './animated-bore';
import { BaseBuilding } from './base-building';
import { packGear } from '@zion/shared';
import { ARCHITECT_ID, BLADE_COMBO, BLADE_COMBO_TOLERANCE_MS, BLADE_COMBO_WEAPONS, bladeStepTiming, nextBladeStep, meleeSwing, LONG_LUNGE_CLIP, type BuildMessage } from '@zion/shared';
import { Vehicles } from './vehicles';
import { BattleRoyaleMatch } from './battle-royale';
import { InfectionMatch } from './infection';
import { WalkingMap, WalkingSearch, type NavPoint } from './navigation';
import { DEFAULT_INFECTION_LOADOUT, DEFAULT_INFECTION_MAP, infectionChoices, infectionInventory, sanitizeInfectionLoadout, zombieInventory, type InfectionLoadout } from '@zion/shared';
import { INFECTION_GROUND, infectionSpawns, infectionZombieSpawns } from '@zion/worldgen';
import { BattleBot, BattleBotDirector, MAX_BATTLE_BOTS } from './battle-bots';
import { type ThrowSpec, shockwaveDamage, shockwaveFront } from '@zion/shared';
import { PropKnock } from './prop-knock';
import { loadHitMeshes } from '../world/hit-meshes';
import { attachmentModifier, droppedDirection, leanOf, leanOffset, opticOf, packAttachments, zeroDistance, type Attachments } from '@zion/shared';
import { BATTLE_LOBBY_RADIUS, BATTLE_MAP, BATTLE_TIME_OF_DAY, keepInCircle, type BattleCircle, generateBattleLoot, vehicleOwner, VEHICLES, type ChestData, type GameMode, type InventoryData, type PlacedItem } from '@zion/shared';
import { randomUUID } from 'node:crypto';
import type { ProgressionService } from './progression';
import { COLONEL_SEARCH_QUESTS } from '@zion/shared';
import { recordZombieKill, tutorialProgress, tutorialProtected, updateTutorial } from './tutorial';
import { CHEST_ASSETS, CHEST_REACH, chestKey } from '@zion/shared';
import { Livestock } from './livestock';
import { C4Charge } from './c4';
import { BaseLife, type AnimalRecord, type LifeWorld } from './base-life';
import { DEFAULT_BASE_LIFE, planCooking, gunBlocksSprint, weaponAttackStaminaCost, type CookingBatch } from '@zion/shared';
import { DEFAULT_CONTENT, InventoryModel, isStash, NPC_ID_BASE, objectiveText, type GameContent } from '@zion/shared';
import { QuestEngine, type QuestEvent } from './quests';
import { authoredWorld } from '@zion/worldgen';
import { BRIDGE_ASSET, CAMP_ASSET as CAMP_IDS, STREET_ASSET, STREET_KIT } from '@zion/assets';
import { BATTLE_ASSET } from '@zion/assets';
import { BATTLE_FLIGHT, battlePlaneAt } from '@zion/shared';
import { characterEyeHeight, copyCharacterState, createCharacterState, doorColliders, stepAirborne, type CharacterState } from '@zion/physics';
import { type TeamService, TeamError } from './teams';
import { TEAM_QUESTS } from '@zion/shared';
import { chooseMissionStructure } from './mission-locations';
import {
  Buttons,
  advanceBallistic,
  bulletSpec,
  gunSpread,
  CHUNK_SIZE,
  Surface,
  ENTITY_INTEREST_RADIUS_CHUNKS,
  FIRE_TOLERANCE_MS,
  GRENADE_GRAVITY,
  aimedThrowSpeed,
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
  armorStaminaFactor,
  weaponSpeedFactor,
  weaponStaminaFactor,
  rollsDecapitation,
  ZombieVariant,
  packArmor,
  MEDKIT_USE_MS,
  DEV_COIN_GRANT,
  ZOMBIE_COIN_DROP_MAX,
  type GunSpec,
  type MeleeSpec,
  type ProjectileSpec,
  MUZZLE_HEIGHT,
  muzzleHeight,
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
import type { AppearanceStore } from '../repositories/accounts';
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
import { CAMP_HALF_SIZE, CAMP_PAD, campDistance } from '@zion/worldgen';
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
const BLADE_HIT_DELAY_MS = 50;
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
  mode?: GameMode;
  /** Character looks, sent to every player in the match. */
  appearances?: AppearanceStore;
  progression?: ProgressionService;
  teams?: TeamService;
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
/**
 * A hard vehicle hit (above ~25 km/h closing speed) throws the body along the blow: heavier and
 * faster vehicles throw further and keep it limp longer. Returns when control comes back (0: no throw).
 */
function throwBody(s: CharacterState, v: { kind: keyof typeof VEHICLES }, dx: number, dz: number, impulse: number, now: number): number {
  const closing = impulse / .55, weight = Math.min(1.5, VEHICLES[v.kind].mass / 900);
  if (closing <= 7) return 0;
  const throwSpeed = (1.6 + closing * .5) * Math.sqrt(weight);
  s.vx = dx * throwSpeed; s.vz = dz * throwSpeed; s.vy = 2 + closing * .15 * weight;
  s.grounded = false; s.prone = false; s.rollTicks = 0; s.climbing = false;
  return now + Math.min(4000, 900 + closing * 140 * weight);
}

/** Names of the bot squads in squad matches. */
const BOT_SQUAD_NAMES = ['Sói Xám', 'Bão Cát', 'Rắn Hổ'];

interface HoldSpot { x: number; y: number; z: number; tiles: Array<{ x: number; y: number; z: number }>; /** Worked-out walk from the street up to it (stairs, ladders). */ route?: NavPoint[] }
const HOLD_SPOTS = new WeakMap<object, HoldSpot[]>();

/** How long a dropped player's place in a running match is held (ms). */
export const REJOIN_GRACE_MS = 150_000;
interface Rejoin { id: number; name: string; until: number; state: CharacterState; yaw: number; health: number; inventory: InventoryData; jumpPoint: { x: number; z: number } | null }

export class GameServer {
  readonly vehicles: Vehicles;
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
  private readonly joiningAccounts = new Set<string>();
  private readonly requisitionRetries = new Map<string, number>();
  private readonly respawning = new Set<number>();
  private readonly log: Logger;
  private readonly epoch = performance.now();
  private readonly stepInfo: StepInfo = { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false };
  private readonly scratch: Player[] = [];
  /** Scoreboard: kills and deaths per player or bot id this match / session. */
  private readonly stats = new Map<number, { kills: number; deaths: number }>();
  private statsDirty = false;
  /** Light props knocked away by vehicles, bullets and blasts. */
  private readonly knock: PropKnock;
  /** Shock waves racing out from blasts: each body is struck once, when the front reaches it. */
  private readonly shocks: Array<{ x: number; y: number; z: number; radius: number; damage: number; owner: Player | null; label: string; start: number; hit: Set<unknown> }> = [];
  private readonly grenades: Array<{ id: number; ownerId: number; owner: Player; s: ProjectileState; explodeAt: number; spec: ThrowSpec }> = [];
  private readonly c4Charges = new Map<number, C4Charge>();
  private nextGrenadeId = 1;
  readonly zombies: ZombieDirector;
  readonly guards: CampGuardDirector;
  readonly merchant: CampNpc;
  readonly nurse: CampNpc;
  /** The camp architect (blueprints for building materials). */
  readonly architect: CampNpc;
  /** Survival base building: felling, mining, structures and supply drops (null in match modes). */
  readonly building: BaseBuilding | null = null;
  /** Supply-drop crates (survival): in-memory chests that come down by parachute. */
  private readonly supplyChests = new Map<string, ChestData>();
  private nextSupplyCrate = 1;
  /** Launcher rounds in flight (40 mm grenades, rockets, bolts). */
  private readonly rounds: Array<{ id: number; owner: Player; w: number; spec: ProjectileSpec; damage: number; knockback: number; traveled: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; dieAt: number; /** Zombies this round already went through. */ pierced?: Set<Combatant> }> = [];
  private readonly activeScratch: Player[] = [];
  private readonly blastHit = makeRayHit();
  /** ZCoin lying on the ground, waiting to be picked up. */
  /** Items players dropped on the ground (visible to everyone, pick-up by anyone). */
  private readonly groundItems = new Map<number, { itemId: string; count?: number; mag?: number; issued?: boolean; attachments?: Attachments; x: number; y: number; z: number; expiresAt: number; livestock?: boolean; quest?: string; contents?: PlacedItem[] }>();
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
  private battle: BattleRoyaleMatch | null = null;
  /** Infection mode: round rules (null in the other modes). */
  private infection: InfectionMatch | null = null;
  private readonly infectionLoadouts = new Map<number, InfectionLoadout>();
  private infectionSpawnIndex = 0;
  private infectionOccupied = false;
  /** When a tick last overran its budget (inputs pile up then through no fault of the player). */
  private lastSlowTickAt = -Infinity;
  private readonly pickupHit = makeRayHit();
  /**
   * Match modes: players who dropped out mid-match (closed tab, crash, lost connection) keep their
   * place for REJOIN_GRACE_MS; coming back puts them where they were with what they carried.
   */
  private readonly rejoins = new Map<string, Rejoin>();
  /** A dropped player of this account is waiting to come back here. */
  hasRejoin(accountId: string): boolean { return this.rejoins.has(accountId) || this.byAccount.has(accountId); }
  /** Infection: the Studio map this server's world was built from, and its rules. */
  private get infectionMap() { return this.deps.world.generator.config.infection ?? DEFAULT_INFECTION_MAP; }
  private get infectionRules() { return this.infectionMap.rules; }
  private get infectionCentre(): number { return this.deps.world.generator.worldSize / 2; }
  /** Battle royale or infection: a match server, no persistent survival world. */
  private get arena(): boolean { return !!this.battle || !!this.infection; }
  /** The world this server plays on. */
  get worldService(): WorldService { return this.deps.world; }
  /** Players in or joining this server (matchmaking load). */
  get headcount(): number { return this.players.size + this.joiningAccounts.size + this.rejoins.size; }
  /** Matchmaking: may one more player join (a match still gathering players, with room)? */
  canAdmit(): boolean {
    if (this.battle) return this.battle.accepting && this.headcount < BATTLE_MAP.maxPlayers;
    if (this.infection) return this.infection.accepting && this.headcount < this.infectionRules.maxPlayers;
    return true;
  }
  private get mode(): GameMode { return this.battle ? 'battle-royale' : this.infection ? 'infection' : 'survival'; }
  private readonly battleChests = new Map<string, ChestData>();
  /** Battle royale bots (null in survival). */
  private readonly bots: BattleBotDirector | null;
  private nextBotAt = 0;
  private readonly deathCrates = new Map<string, { id: string; x: number; y: number; z: number }>();
  private readonly battleDoors = new Map<number, { x: number; y: number; z: number; yaw: number; open: boolean }>();
  private readonly doorUsedAt = new Map<number, number>();
  private battleWasOccupied = false;
  private battleFlightStarted = false;

  constructor(private readonly deps: GameServerDeps) {
    if (deps.mode === 'battle-royale') this.battle = this.newBattleMatch();
    if (deps.mode === 'infection') this.infection = new InfectionMatch(this.infectionRules, this.infectionMap.name);
    if (this.arena) for (const site of allStructures(deps.world.generator)) for (const [i, part] of site.parts.entries()) if (part.asset === BATTLE_ASSET.door) {
      const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
      this.battleDoors.set(site.gid * 10000 + i, { x: site.x + part.x * c + part.z * s, y: site.y + part.y, z: site.z - part.x * s + part.z * c, yaw: site.yaw + part.yaw, open: false });
    }
    this.chests = new SharedChests({
      near: (p, id) => this.chestNear(p, id),
      // Battle chests come pre-filled (an open container grid, no search step).
      load: (id) => this.supplyChests.has(id) ? Promise.resolve(structuredClone(this.supplyChests.get(id)!)) : this.battle ? Promise.resolve(this.battleChests.get(id) ?? { items: generateBattleLoot([]), searched: true, revision: 0, day: 0 }) : deps.playerStates.loadChest(id),
      commit: (id, data, p, inventory) => {
        if (this.supplyChests.has(id)) {
          this.supplyChests.set(id, structuredClone(data));
          // The crate stays until it is emptied.
          if (!data.items.length) { this.supplyChests.delete(id); this.deathCrates.delete(id); this.broadcast({ t: 'lootCrates', crates: [...this.deathCrates.values()] }); }
          if (p) p.dirty = true;
          return Promise.resolve();
        }
        if (this.battle) { this.battleChests.set(id, structuredClone(data)); return Promise.resolve(); }
        return deps.playerStates.saveChestAndPlayer(id, data, p ? { accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory, journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies } : undefined);
      },
      loot: this.battle ? generateBattleLoot : undefined,
      searchMs: this.battle ? 1000 : undefined,
      sync: (p) => { p.cancelReload(); this.syncLoadout(p); this.sendInv(p); },
      finish: (p) => this.finishQuestMutation(p),
      error: (err) => this.log.error({ err }, 'shared chest transaction failed'),
    }, () => this.serverTime, () => this.battle ? 0 : Math.floor(this.worldTimeMs / this.dayLengthMs));
    this.log = deps.logger.child({ module: 'game' });
    const gen = deps.world.generator;
    this.collision = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: gen.seaLevel });
    // Shots test props against their real model surfaces (gaps, windows, lattices).
    this.collision.setHitMeshes(loadHitMeshes());
    this.vehicles = new Vehicles(this.collision, gen);
    for (const [id, door] of this.battleDoors) this.collision.setOwnerColliders(0xb0000000 + id, doorColliders(door));
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
    // Bots play battle royale only (Infection is people against people).
    this.bots = this.battle ? new BattleBotDirector(this.collision, {
      shot: (e) => this.broadcastAt(e.ox, e.oz, e),
      projectile: (e) => this.broadcastAt(e.x, e.z, e),
      projectileEnd: (e) => this.broadcastAt(e.x, e.z, e),
      hitPlayer: (bot, player, damage, zone, x, y, z, now) => {
        this.damage(bot.id, player, damage, zone, x, y, z, now, bot.name);
      },
      ...(deps.mode === 'infection' ? {
        enemy: (bot: BattleBot, id: number) => !!this.infection?.entrants.has(id) && this.infection.isZombie(bot.id) !== this.infection.isZombie(id),
        botHitsBot: (attacker: BattleBot, target: BattleBot, damage: number, zone: string, now: number) => { this.infectionBotDamage(target, damage, attacker.id, attacker.state, zone, now); return true; },
      } : {}),
      ...(deps.mode === 'battle-royale' ? { canHurt: (bot: BattleBot) => !!this.battle?.canFight(bot.id) } : {}),
      died: (bot, by, now, killerId) => this.botDied(bot, by, now, killerId),
      chests: (x, z, radius) => this.battleChestsNear(x, z, radius),
      loot: (id, choose) => this.botLoot(id, choose),
      openDoor: (x, y, z, yaw) => {
        // A closed door within reach ahead swings open (same as a player pressing E).
        for (const [id, door] of this.battleDoors) {
          if (door.open || Math.abs(door.y - y) > 1.6) continue;
          const dx = door.x - x, dz = door.z - z, d = Math.hypot(dx, dz);
          if (d > 2.2 || (d > .4 && (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d < .3)) continue;
          door.open = true;
          this.collision.setOwnerColliders(0xb0000000 + id, doorColliders(door));
          this.broadcast({ t: 'door', id, ...door });
        }
      },
    }) : null;
    if (this.battle) this.scatterGroundLoot();
    this.guards = new CampGuardDirector(gen.camp, this.collision, {
      shot: (message) => this.broadcastAt(message.ox, message.oz, message),
      projectile: (message) => this.broadcastAt(message.x, message.z, message),
      projectileEnd: (message) => this.broadcastAt(message.x, message.z, message),
      hit: (guard, zombie, damage, zone, x, y, z, dx, dz, now) =>
        this.hitZombie(null, zombie, damage, zone, x, y, z, dx, dz, 1.2, now, guard.id),
    });
    this.merchant = new CampNpc(MERCHANT_ID, EntityKind.Merchant, gen.camp, NPC_STALLS.merchant, this.collision);
    this.nurse = new CampNpc(NURSE_ID, EntityKind.Nurse, gen.camp, NPC_STALLS.nurse, this.collision);
    this.architect = new CampNpc(ARCHITECT_ID, EntityKind.Architect, gen.camp, NPC_STALLS.architect, this.collision);
    if (!this.arena) this.building = new BaseBuilding({
      collision: this.collision, physics: this.physics, world: deps.world, registry: deps.registry, zombies: this.zombies,
      camp: gen.camp,
      players: () => this.players.values(),
      broadcast: (msg) => this.broadcast(msg),
      reply: (p, text) => this.reply(p, text),
      inventoryChanged: (p) => { this.syncLoadout(p); this.sendInv(p); },
      dropItem: (itemId, count, x, y, z) => this.spawnGroundItem(itemId, count, x, y, z),
      addCoins: (p, amount, ok) => { if (!ok) return this.addCoins(p, amount); p.coins = Math.max(0, p.coins + amount); p.dirty = true; p.session.sendJson({ t: 'wallet', coins: p.coins, ok: true }); },
      teammates: (a, b) => this.deps.teams?.allied(a, b) ?? false,
      landCrate: (items, x, y, z) => this.landSupplyCrate(items, x, y, z),
      landVehicle: (kind, x, y, z, yaw) => this.vehicles.deliver(kind, x, y, z, yaw),
      atArchitect: (p) => this.architect.inReach(p, MERCHANT_REACH + 1),
      save: (list) => this.deps.worlds.saveStructures?.(this.deps.worldId, list) ?? Promise.resolve(),
      error: (err, what) => this.log.error({ err }, what),
      now: () => this.serverTime,
    });
    // After base building, whose felled trees also leave the collision world.
    this.knock = new PropKnock({
      world: deps.world, registry: deps.registry, physics: this.physics,
      broadcastAt: (x, z, msg) => this.broadcastAt(x, z, msg),
      broadcast: (msg) => this.broadcast(msg),
      occupied: (x, z, r) => [...this.players.values()].some((p) => !p.dead && Math.hypot(p.state.x - x, p.state.z - z) < r) || this.zombies.near(x, z, r).some((zb) => !zb.dead),
    });
    this.worldTimeMs = deps.initialWorldTimeMs;
    this.applyContent(this.content);
    if (this.infection) this.vehicles.available = false;
  }

  applyContent(content: GameContent): void {
    if (this.arena) content = { ...content, npcs: [], quests: [], baseLife: { ...DEFAULT_BASE_LIFE, animals: [], plots: [], crops: [], stations: [], trades: [], recipes: [], decorations: [], stamina: { ...DEFAULT_BASE_LIFE.stamina, capacityDecay: 0 } } };
    this.content = structuredClone(content);
    // Add the chef's new stock to worlds with an older saved Camp Studio catalogue.
    if (this.content.baseLife && this.content.npcs.some((n) => n.id === 'chef') &&
        !this.content.baseLife.trades.some((t) => t.npc === 'chef' && t.item === 'coal_carton')) {
      this.content.baseLife.trades.push(structuredClone(DEFAULT_BASE_LIFE.trades.find((t) => t.id === 'chef_coal_carton')!));
    }
    if (!this.arena) for (const quest of COLONEL_SEARCH_QUESTS) if (!this.content.quests.some((q) => q.id === quest.id)) this.content.quests.push(structuredClone(quest));
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
      const loc = chooseMissionStructure(allStructures(this.deps.world.generator), o.structure, camp);
      if (loc) r.location = { x: loc.x, z: loc.z, radius: loc.radius };
    }
  }

  private async refreshRank(p: Player, announce = false): Promise<void> {
    if (!this.deps.progression) return;
    const rank = await this.deps.progression.title(p.accountId);
    const promoted = announce && rank.step > p.rank.step;
    p.rank = rank;
    p.session.sendJson({ t: 'rank', rank, promoted, ...(promoted ? { introduction: `Đại tá: Chúc mừng ${p.username}. Cậu đã đạt ${rank.title}. Quân hàm ghi nhận những nhiệm vụ đã hoàn thành và bản lĩnh sống sót. Phần thưởng đã được gửi vào Quân nhu ở sảnh chính. Giữ vững danh hiệu; mỗi lần hy sinh đều ảnh hưởng đến hồ sơ quân vụ.` } : {}) });
    if (promoted) this.broadcast({ t: 'chat', from: 'BỘ CHỈ HUY', fromId: 0, text: `📣 ${p.username} vừa được thăng quân hàm ${rank.title}!`, system: true, announcement: true, rank });
    this.broadcastPlayerList();
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

  studioWallet(accountId: string): number | undefined { return this.byAccount.get(accountId)?.coins; }

  /** Queue busy/joining players; offline accounts receive their durable credit on their next join. */
  async receiveStudioCurrency(accountId: string): Promise<void> {
    const p = this.byAccount.get(accountId);
    if (!p) {
      if (this.joiningAccounts.has(accountId)) this.requisitionRetries.set(accountId, Date.now() + 1000);
      return;
    }
    if (p.questBusy) { this.requisitionRetries.set(accountId, Date.now() + 1000); return; }
    this.requisitionRetries.delete(accountId);
    p.questBusy = true;
    try {
      const state = await this.deps.playerStates.deliverRequisitions({ accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies }, true);
      const received = (state.coins ?? p.coins) - p.coins;
      p.coins = state.coins ?? p.coins;
      p.dirty = true;
      p.session.sendJson({ t: 'wallet', coins: p.coins });
      if (received > 0) this.reply(p, `Bạn vừa được cấp ${received.toLocaleString('vi-VN')} ZCoin từ Studio.`);
    } catch (err) {
      this.requisitionRetries.set(accountId, Date.now() + 5000);
      this.log.error({ err, accountId }, 'Studio currency delivery deferred');
    } finally { this.finishQuestMutation(p); }
  }

  private sendQuests(p: Player): void {
    this.quests.reset(p, Date.now());
    this.resolveQuestLocations(p);
    this.placeQuestDrops(p);
    p.session.sendJson({ t: 'questNpcs', npcs: this.content.npcs.map((n) => {
      const entity = this.questNpcs.get(n.id)!;
      return { id: entity.id, key: n.id, name: n.name, model: n.model, x: entity.x, y: entity.y, z: entity.z };
    }) });
    p.session.sendJson({ t: 'quests', entries: [...this.content.quests.filter((q) => q.enabled).map((q) => {
      const r = p.journal[q.id];
      const o = q.objectives[r?.stage ?? 0];
      return { id: q.id, npc: q.npc, title: q.title, description: q.description, kind: q.kind, dialogue: q.dialogue, rewards: q.rewards, allowCancel: q.allowCancel !== false, locked: q.prereq.some((id) => p.journal[id]?.status !== 'claimed'), stage: r?.stage ?? 0, stages: q.objectives.length, goal: o && 'count' in o ? o.count : 1, objective: o ? objectiveText(o) : '', status: r?.status ?? 'available', progress: r?.progress ?? 0, ...(r?.status === 'active' && o?.type === 'retrieve' ? { retrievalItem: o.item, retrievalModel: this.life.config.itemModels?.[o.item] } : {}), ...(r?.location ? { target: r.location } : {}), ...(r?.status === 'active' && r.drops?.length ? { drops: r.drops } : {}) };
    }), ...(this.deps.teams?.questViews(p.accountId) ?? [])] });
  }

  private async onQuest(p: Player, msg: Extract<ClientMessage, { t: 'quest' }>): Promise<void> {
    if (p.dead || p.questBusy) return;
    if (msg.quest?.startsWith('team_')) { await this.onTeamQuest(p, msg); return; }
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
      const career = this.deps.progression?.config;
      const claimed = copy.journal[def.id]?.status === 'claimed' && p.journal[def.id]?.status !== 'claimed';
      const points = def.rankPoints ?? ((def.kind === 'daily' ? career?.dailyPoints : career?.longPoints) ?? 0) + (def.objectives.some((o) => o.type === 'retrieve' || o.type === 'visit' || o.type === 'kill') ? career?.externalBonus ?? 0 : 0);
      await this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.health, coins: copy.coins, inventory: copy.inv.toJSON(), journal: copy.journal, life: structuredClone(p.life), suspendedZombies: p.suspendedZombies, ...(claimed ? { careerEvent: { id: `quest:${this.deps.worldId}:${def.id}:${def.kind === 'daily' ? copy.journal[def.id]!.cycle : 'once'}`, points } } : {}) }]);
      const stashed = copy.inv.items.filter((i) => isStash(i.container)).length - p.inv.items.filter((i) => isStash(i.container)).length;
      if (stashed > 0) this.reply(p, `Ba lô đầy: ${stashed} phần thưởng đã được gửi vào kho cá nhân ở căn cứ.`);
      p.journal = copy.journal;
      p.coins = copy.coins;
      p.inv.load(copy.inv.toJSON());
      p.dirty = true;
      this.sendInv(p);
      p.session.sendJson({ t: 'wallet', coins: p.coins });
      this.sendQuests(p);
      if (claimed) await this.refreshRank(p, true);
      if (msg.op === 'retrieve') return;
      const line = msg.op === 'accept' ? def.dialogue.accept : p.journal[def.id]?.status === 'claimed' ? def.dialogue.complete : def.dialogue.progress;
      if (entity) p.session.sendJson({ t: 'speech', npc: entity.id, text: line, duration: npc.bubbleMs, x: entity.x, y: entity.y, z: entity.z });
    } catch (err) { this.log.error({ err, accountId: p.accountId }, 'quest transaction failed'); }
    finally { this.finishQuestMutation(p); }
  }

  private allied(a: Player, b: Player): boolean { return this.infection ? this.infection.allies(a.id, b.id) : this.battle ? this.battle.allies(a.id, b.id) : this.deps.teams?.allied(a.accountId, b.accountId) ?? false; }
  /** Battle royale: only players who dropped in with their squad see and share the team. */
  private squadOf(p: Player) { return this.infection || (this.battle && !p.session.squad) ? undefined : this.deps.teams?.forAccount(p.accountId); }

  private sendTeam(p: Player): void {
    const team = this.squadOf(p) ? this.deps.teams?.view(p.accountId) ?? null : null;
    p.session.sendJson({ t: 'teamState', team, quests: this.arena ? [] : this.deps.teams?.questViews(p.accountId) ?? [] });
  }

  private async onTeamQuest(p: Player, msg: Extract<ClientMessage, { t: 'quest' }>): Promise<void> {
    const teams = this.deps.teams, def = TEAM_QUESTS.find((q) => q.id === msg.quest && q.npc === msg.npc);
    const npc = this.content.npcs.find((n) => n.id === msg.npc), entity = npc && this.questNpcs.get(npc.id);
    if (!teams || !def || !npc || p.downed || msg.op === 'list') return;
    if (msg.op !== 'retrieve' && msg.op !== 'cancel' && (!entity?.inReach(p, npc.interactRange) || Math.abs(p.state.y - entity.y) > 4)) return;
    if (msg.op === 'retrieve' && Math.abs(p.state.y - this.deps.world.generator.heightAt(p.state.x, p.state.z)) > 3) return;
    const camp = this.deps.world.generator.camp;
    const target = msg.op === 'accept' ? chooseMissionStructure(allStructures(this.deps.world.generator), def.structure, camp) : undefined;
    p.questBusy = true;
    let coins: number | undefined;
    try {
      const changed = await teams.quest(p.accountId, def.id, msg.op, { target, index: msg.index, x: p.state.x, z: p.state.z, rankPoints: this.deps.progression?.config.teamPoints, reward: () => {
        coins = p.coins + def.coins;
        return { accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies };
      } });
      if (changed && coins !== undefined) { p.coins = coins; p.dirty = true; p.session.sendJson({ t: 'wallet', coins: p.coins }); await this.refreshRank(p, true); }
      if (changed && entity && msg.op !== 'retrieve') p.session.sendJson({ t: 'speech', npc: entity.id, text: msg.op === 'accept' ? `${def.offer} Đi cùng nhau và nhớ trở về!` : msg.op === 'turnin' ? 'Cả đội đã hoàn thành xuất sắc. Phần thưởng của cậu đây; các đồng đội cũng có phần riêng.' : 'Ta sẽ chờ đội các cậu sẵn sàng cho lần tới.', duration: npc.bubbleMs, x: entity.x, y: entity.y, z: entity.z });
    } catch (err) { if (err instanceof TeamError) this.reply(p, err.message); else this.log.error({ err }, 'team quest transaction failed'); }
    finally {
      this.finishQuestMutation(p);
      for (const member of this.players.values()) if (member === p || this.allied(p, member)) this.sendTeam(member);
    }
  }

  private readonly pendingSaves = new Map<string, Promise<void>>();

  /** Test helpers (free coins, clock jumps, teleports) only outside production. */
  private get devTools(): boolean {
    return this.deps.config.NODE_ENV !== 'production';
  }

  /** Camp NPCs that are not soldiers: they keep a shotgun out of sight and only fire back. */
  private peacefulNpcs(): CampNpc[] {
    const out: CampNpc[] = [this.merchant, this.nurse, this.architect];
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
    if (this.arena) return;
    if (p.questBusy) return;
    if (!p.session.open || p.onLeaveSaved) void this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies }]).catch((err: unknown) => this.log.error({ err }, 'post-disconnect transaction save failed')).finally(() => { p.onLeaveSaved?.(); p.onLeaveSaved = null; });
  }

  private queueQuestEvent(p: Player, event: QuestEvent): void {
    if (this.arena) return;
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
      await this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: owner.journal, life: structuredClone(p.life), suspendedZombies: p.suspendedZombies }]);
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

  private hitAnimal(attacker: Player | null, animal: Livestock, damage: number, now: number, x = animal.state.x, y = animal.state.y + 0.5, z = animal.state.z, fire = false): void {
    if (this.lifeBusy || animal.dead) return;
    animal.hit(damage, attacker, now, fire);
    this.broadcastAt(animal.state.x, animal.state.z, { t: 'hit', attackerId: attacker?.id ?? 0, targetId: animal.id, damage, zone: fire ? 'fire' : 'torso', x, y, z });
    if (!animal.dead) return;
    this.dropAnimalLoot(animal);
    for (const p of this.players.values()) this.sendLife(p);
  }

  private cancelLifeAction(p: Player, notify = true): void {
    if ((p.lifeAction?.kind === 'plant' || p.lifeAction?.kind === 'harvest') && this.plotLocks.get(p.lifeAction.target) === p.id) this.plotLocks.delete(p.lifeAction.target);
    p.lifeAction = null;
    if (notify) this.sendLife(p);
  }

  private sendLife(p: Player): void {
    const camp = this.deps.world.generator.camp;
    const config = this.life.config;
    const objects: Array<{ id: string; model: string; x: number; y: number; z: number; cooking?: boolean; expiresAt?: number }> = [];
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
      const model = config.itemModels?.[animal.lootItem];
      if (animal.record.loot > 0 && model) objects.push({ id: `loot_${id}`, model, x: animal.state.x + 0.5, y: animal.state.y, z: animal.state.z });
    }
    for (const coal of Object.values(this.lifeWorld.coals ?? {})) if (coal.expiresAt > Date.now()) objects.push({ ...coal, cooking: true, model: '/models/dists/glowing-coal-pile.bbmodel' });
    // The (large) config only when it is new to this player; world state on every change.
    const withConfig = p.lifeConfig !== config;
    p.lifeConfig = config;
    p.session.sendJson({ t: 'baseLife', ...(withConfig ? { config } : {}), objects, plots: this.lifeWorld.plots, animalLoot: [...this.animals].filter(([, a]) => a.record.loot > 0).map(([id, a]) => ({ id, item: a.lootItem, quantity: a.record.loot, x: a.state.x, y: a.state.y, z: a.state.z })), ...this.lifeStats(p) });
  }

  /** Per-player stamina / timed action (small; sent every second). */
  private lifeStats(p: Player): { stamina: number; capacity: number; action: { end: number; kind: string; ms: number } | null } {
    return { stamina: p.life.stamina, capacity: p.life.capacity, action: p.lifeAction ? { end: p.lifeAction.end, kind: p.lifeAction.kind, ms: p.lifeAction.ms } : null };
  }

  private cookingStation(p: Player, id: string, until = Date.now()): boolean {
    const coal = this.lifeWorld.coals?.[id];
    const camp = this.deps.world.generator.camp;
    const station = this.life.config.stations.find(s => s.id === id);
    const spot = coal && coal.expiresAt > until ? coal : !coal && camp && station ? { x: camp.x + station.x, y: camp.y, z: camp.z + station.z } : null;
    return !!spot && Math.abs(p.state.y - spot.y) <= 3 && Math.hypot(p.state.x - spot.x, p.state.z - spot.z) <= this.life.config.interactionRange;
  }

  private async onLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>): Promise<void> {
    if (p.dead || p.questBusy || p.lifeAction || this.lifeBusy) return;
    if (msg.op === 'cook') {
      const batch = planCooking(this.life.config, p.inv.items);
      if (!batch || !this.cookingStation(p, msg.target, Date.now() + batch.durationMs)) return;
      p.lifeAction = { kind: 'cook', target: msg.target, choice: '', x: p.state.x, z: p.state.z,
        end: Date.now() + batch.durationMs, ms: batch.durationMs, cookBatch: batch };
      this.sendLife(p);
      return;
    }
    if (msg.op === 'plant' || msg.op === 'harvest') {
      const spot = this.life.config.plots.find((s) => s.id === msg.target);
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
    } else if (msg.op === 'cook' && timed && cooking && this.cookingStation(p, msg.target)) {
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
        for (let i = 0; i < record.loot; i++) if (!owner.inv.add(animal.lootItem)) { ok = false; break; }
        if (ok) { event = { type: 'collect', target: animal.lootItem, quantity: record.loot }; record.loot = 0; }
      }
    } else if (msg.op === 'ignite') {
      const item = owner.inv.carriedItem(msg.uid ?? -1);
      if (item?.itemId !== 'coal_carton') return;
      const x = p.state.x - Math.sin(p.yaw) * 2, z = p.state.z - Math.cos(p.yaw) * 2;
      if (!Number.isFinite(this.collision.terrainHeight(x, z))) return;
      // Open fires are not allowed inside the main base; the chef's campfire serves it.
      const camp = this.deps.world.generator.camp;
      if (camp && campDistance(camp, x, z) <= CAMP_PAD) return;
      if (this.collision.raycast(p.state.x, p.state.y + 1, p.state.z, -Math.sin(p.yaw), 0, -Math.cos(p.yaw), 2.3, Mask.LineOfSight, this.blastHit)) return;
      if (!this.collision.raycast(x, p.state.y + 1, z, 0, -1, 0, 3, Mask.LineOfSight, this.blastHit)) return;
      const y = this.blastHit.y;
      if (this.blastHit.ny < .8 || y <= this.collision.waterLevel(x, z) || Math.abs(y - p.state.y) > 1.5) return;
      if (Object.values(world.coals ?? {}).some(c => c.expiresAt > Date.now() && Math.hypot(c.x - x, c.z - z) < 1.5)) return;
      owner.inv.useCharge(item.uid);
      const id = 'coal_' + randomUUID().replaceAll('-', '').slice(0, 24);
      (world.coals ??= {})[id] = { id, x, y, z, expiresAt: Date.now() + 600_000 };
      ok = true;
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
      owner.life.tutorial = p.life.tutorial;
      p.life = owner.life;
      p.journal = owner.journal;
      p.coins = owner.coins;
      p.inv.load(owner.inv.toJSON());
      p.dirty = true;
      this.sendInv(p);
      this.sendQuests(p);
      p.session.sendJson({ t: 'wallet', coins: p.coins, ...((msg.op === 'buy' || msg.op === 'sell') ? { ok: true } : {}) });
      for (const player of this.players.values()) this.sendLife(player);
    } catch (err) { this.log.error({ err }, 'base life transaction failed'); }
    finally { this.lifeBusy = false; this.finishQuestMutation(p); }
  }

  /* ------------------------------------ clock ------------------------------------------- */

  /** Monotonic server time in ms (snapshot timeline, lag compensation). */
  get serverTime(): number {
    return performance.now() - this.epoch;
  }

  get vehicleJolt(): boolean { return this.vehicles.jolt; }
  set vehicleJolt(on: boolean) { this.vehicles.jolt = on; }

  get dayLengthMs(): number {
    return this.deps.config.DAY_LENGTH_MINUTES * 60_000;
  }

  timeOfDay(): number {
    // Battle royale is always played at 14:00: steady daylight, no night.
    if (this.battle) return BATTLE_TIME_OF_DAY;
    if (this.infection) {
      // Fixed hour, or a day-night cycle running from that hour (Studio rules).
      const cycle = this.infectionRules.dayCycleMinutes ?? 0, t = this.infectionRules.timeOfDay + (cycle > 0 ? this.serverTime / (cycle * 60_000) : 0);
      return t - Math.floor(t);
    }
    const t = this.worldTimeMs / this.dayLengthMs + 0.3;
    return t - Math.floor(t);
  }

  worldInfo(): WorldInfo {
    const gen = this.deps.world.generator;
    return {
      mode: this.mode,
      worldId: this.deps.worldId,
      sizeChunks: gen.config.sizeChunks,
      chunkSize: CHUNK_SIZE,
      seaLevel: gen.seaLevel,
      generatorVersion: gen.config.generatorVersion,
      dayLengthSec: this.dayLengthMs / 1000,
      cosmeticSeed: gen.cosmeticSeed,
      camp: gen.camp ? { x: gen.camp.x, z: gen.camp.z, halfSize: CAMP_HALF_SIZE } : null,
      ...(this.deps.world.extraAssets.length ? { assets: [...this.deps.world.extraAssets] } : {}),
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
    if (this.building && this.deps.worlds.loadStructures) {
      this.deps.worlds.loadStructures(this.deps.worldId).then((list) => this.building?.load(list)).catch((err: unknown) => this.log.error({ err }, 'structures load failed'));
    }
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
    await this.building?.flush().catch((err: unknown) => this.log.error({ err }, 'structures save failed'));
  }

  /* ------------------------------------ join/leave --------------------------------------- */

  async join(session: ClientSession): Promise<void> {
    const rejoining = this.arena && (this.rejoins.has(session.account?.accountId ?? '') || this.byAccount.has(session.account?.accountId ?? ''));
    if (this.infection && !rejoining && (!this.infection.accepting || this.players.size + this.joiningAccounts.size >= this.infectionRules.maxPlayers)) {
      session.sendError('server_full', 'Phòng Lây Nhiễm đã đủ người. Hãy thử lại sau.', true);
      session.close(CloseCode.ServerFull, 'infection full'); return;
    }
    if (this.battle && !rejoining && (!this.battle.accepting || this.players.size + this.joiningAccounts.size >= BATTLE_MAP.maxPlayers)) {
      session.sendError('server_full', 'Trận Battle Royale đang diễn ra hoặc đã đủ 32 người. Hãy quay lại sảnh và thử trận sau.', true);
      session.close(CloseCode.ServerFull, 'battle unavailable'); return;
    }
    const acc = session.account;
    if (!acc) throw new Error('join without account');
    if (this.joiningAccounts.has(acc.accountId)) {
      session.sendError('duplicate_session', 'account is already joining', true);
      session.close(CloseCode.DuplicateSession, 'duplicate session');
      return;
    }
    if (this.players.size + this.joiningAccounts.size >= MAX_PLAYERS) {
      session.sendError('server_full', 'server is full', true);
      session.close(CloseCode.ServerFull, 'server full');
      return;
    }
    // Reserve the account before loading state or consuming Quân nhu deliveries. Two sockets
    // must never enter with separate snapshots of the same wallet/inventory.
    this.joiningAccounts.add(acc.accountId);
    try { await this.joinAccount(session); }
    finally { this.joiningAccounts.delete(acc.accountId); }
  }

  private async joinAccount(session: ClientSession): Promise<void> {
    const acc = session.account!;
    const existing = this.byAccount.get(acc.accountId);
    if (existing) {
      existing.session.sendError('duplicate_session', 'you logged in from another location', true);
      this.leave(existing.session, 'duplicate_session');
      existing.session.close(CloseCode.DuplicateSession, 'duplicate session');
    }

    await this.pendingSaves.get(acc.accountId);
    let saved = this.arena ? null : await this.deps.playerStates.load(acc.accountId);
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
      const back = this.arena ? this.rejoins.get(acc.accountId) : undefined;
      if (back) { await this.physics.ensureArea(Math.floor(back.state.x / CHUNK_SIZE), Math.floor(back.state.z / CHUNK_SIZE), 1); pos = { x: back.state.x, y: back.state.y, z: back.state.z }; }
      else if (this.infection) { await this.physics.ensureArea(Math.floor(this.infectionCentre / CHUNK_SIZE), Math.floor(this.infectionCentre / CHUNK_SIZE), 3); pos = this.infectionSpot(); }
      pos ??= await this.spawns.pickSpawn();
      // Battle royale: everyone waits for the drop together, inside the lobby ring.
      if (this.battle && !back) pos = await this.lobbySpot(pos);
    } finally {
      this.joining.delete(session.id);
    }
    if (!session.open) return;
    const rejoin = this.arena ? this.rejoins.get(acc.accountId) : undefined;
    if (this.battle && !this.battle.accepting && !rejoin) { session.sendError('server_full', 'Trận đã bắt đầu. Hãy thử trận tiếp theo.', true); session.close(CloseCode.ServerFull, 'battle started'); return; }
    if (this.deps.progression) saved = await this.deps.playerStates.deliverRequisitions({ accountId: acc.accountId, x: pos.x, y: pos.y, z: pos.z, yaw: saved?.yaw ?? 0, health, coins: saved?.coins ?? STARTING_ZCOIN, inventory: saved?.inventory ?? defaultLoadout(), journal: saved?.journal, life: saved?.life, suspendedZombies: saved?.suspendedZombies ?? [] });
    const joinedRank = await this.deps.progression?.title(acc.accountId);
    const look = await this.deps.appearances?.loadAppearance(acc.accountId).catch((err: unknown) => { this.log.warn({ err, accountId: acc.accountId }, 'appearance unavailable'); return null; });
    if (!session.open) return;
    if (this.byAccount.has(acc.accountId)) {
      session.sendError('duplicate_session', 'already connected', true);
      session.close(CloseCode.DuplicateSession, 'duplicate session');
      return;
    }

    // Back in the same match: same entity (the match knows it by id), same body and kit.
    const player = new Player(rejoin ? rejoin.id : this.nextEntityId++, acc.accountId, acc.username, session, pos.x, pos.y, pos.z);
    if (rejoin) this.rejoins.delete(acc.accountId);
    player.yaw = saved?.yaw ?? 0;
    player.health = health;
    player.coins = this.arena ? 0 : Math.max(0, Math.round(saved?.coins ?? STARTING_ZCOIN));
    player.life = saved?.life?.quotas ? saved.life : this.life.initial();
    player.life.capacity = Math.min(this.life.config.stamina.maximum, Math.max(this.life.config.stamina.minimumCapacity, player.life.capacity));
    player.life.stamina = Math.max(0, Math.min(player.life.capacity, player.life.stamina));
    player.journal = saved?.journal ?? {};
    player.suspendedZombies = saved?.suspendedZombies ?? [];
    if (joinedRank) player.rank = joinedRank;
    if (look) player.look = look;
    this.quests.reset(player, Date.now());
    player.inv.load(this.infection ? (this.infection.joinsAsZombie ? zombieInventory() : infectionInventory(DEFAULT_INFECTION_LOADOUT)) : this.battle ? { items: [], equipped: null } : saved?.inventory ?? defaultLoadout());
    // Placed explosives are world-session objects. Discard remotes whose charge no longer exists.
    player.inv.load({ ...player.inv.toJSON(), items: player.inv.items.filter(item => {
      if (item.itemId !== 'c4_detonator') return true;
      const charge = item.chargeId ? this.c4Charges.get(item.chargeId) : undefined;
      return charge?.accountId === player.accountId && charge.itemUid === item.uid;
    }) });
    if (rejoin) {
      Object.assign(player.state, rejoin.state);
      player.yaw = rejoin.yaw; player.health = rejoin.health;
      player.inv.load(this.infection ? (this.infection.isZombie(player.id) ? zombieInventory() : infectionInventory(this.infectionLoadouts.get(player.id) ?? DEFAULT_INFECTION_LOADOUT)) : rejoin.inventory);
      if (rejoin.jumpPoint) player.jumpPoint = rejoin.jumpPoint;
    }
    this.syncLoadout(player);
    if (!rejoin?.state.flight) player.state.grounded = true;
    player.streamer = new ChunkStreamer(session, this.deps.world, this.deps.world.generator.config.sizeChunks, this.deps.metrics);
    player.streamer.setCenter(player.chunkX, player.chunkZ);
    player.history.push(this.serverTime, pos.x, pos.y, pos.z, player.yaw);
    player.active = true;
    session.player = player;
    session.state = 'playing';
    this.players.set(player.id, player);
    this.byAccount.set(acc.accountId, player);
    this.grid.update(player);
    // Arena modes: a fresh player enters matchmaking only once its client has loaded the map
    // ('ready'), so slow connections never start a round still loading.
    if (this.battle && !rejoin) {
      const squad = session.squad ? this.deps.teams?.forAccount(acc.accountId) : undefined;
      player.pendingMatch = { ...(squad ? { squad: { id: squad.id, name: squad.name, size: squad.members.length } } : {}), since: this.serverTime };
      this.battleWasOccupied = true;
    }
    if (this.infection) { if (!rejoin) player.pendingMatch = { since: this.serverTime }; this.syncLoadout(player); this.infectionOccupied = true; }
    if (rejoin) this.broadcast({ t: 'chat', from: this.battle ? 'BATTLE ROYALE' : 'LÂY NHIỄM', fromId: 0, system: true, text: `${player.username} đã vào lại trận.` });
    this.deps.metrics.players = this.players.size;

    session.sendJson({
      t: 'welcome',
      mode: this.mode,
      playerId: player.id,
      username: player.username,
      world: this.worldInfo(),
      tickRate: TICK_RATE,
      serverTime: this.serverTime,
      spawn: { x: pos.x, y: pos.y, z: pos.z, yaw: player.yaw },
    });
    session.sendJson({ t: 'wallet', coins: player.coins });
    session.sendJson({ t: 'rank', rank: player.rank });
    this.zombies.restore(player);
    this.syncVegetation(player);
    this.sendInv(player);
    if (this.arena) for (const [id, door] of this.battleDoors) session.sendJson({ t: 'door', id, ...door });
    this.sendQuests(player);
    this.sendTeam(player);
    this.sendLife(player);
    if (this.infection) this.broadcastInfection();
    else if (!this.battle) player.session.sendJson({ t: 'tutorialState', ...tutorialProgress(player) });
    else player.session.sendJson(this.battle.state(this.serverTime, player.id));
    session.sendJson({ t: 'ground', items: [...this.groundItems].map(([id, g]) => ({ id, itemId: g.itemId, count: g.count, x: g.x, y: g.y, z: g.z })) });
    if (this.battle || this.deathCrates.size) session.sendJson({ t: 'lootCrates', crates: [...this.deathCrates.values()] });
    this.building?.welcome(player);
    if (this.knock) player.session.sendJson(this.knock.message());
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
    this.vehicles.release(p);
    this.cancelLifeAction(p, false);
    p.suspendedZombies.push(...this.zombies.suspend(p, [...this.players.values()]));
    p.active = false;
    this.players.delete(p.id);
    this.requisitionRetries.delete(p.accountId);
    this.deps.teams?.position(p.accountId, null);
    if (this.byAccount.get(p.accountId) === p) this.byAccount.delete(p.accountId);
    this.grid.remove(p);
    this.deps.metrics.players = this.players.size;
    // The final save is tracked per account: a re-login waits for it before loading, so it can
    // never start from a stale row (no rollback / duplication by quick reconnects).
    // Dropped out of a running match (not eliminated, not sent home): hold the place a while.
    const dropped = (reason === 'disconnect' || reason === 'duplicate_session') && !p.dead && !p.downed
      && (!!this.battle?.canFight(p.id) || (!!this.infection && this.infection.phase !== 'waiting' && this.infection.entrants.has(p.id)));
    if (dropped) {
      this.rejoins.set(p.accountId, { id: p.id, name: p.username, until: this.serverTime + REJOIN_GRACE_MS, state: copyCharacterState(p.state, createCharacterState(0, 0, 0)), yaw: p.yaw, health: p.health, inventory: p.inv.toJSON(), jumpPoint: p.jumpPoint });
      this.broadcast({ t: 'chat', from: this.battle ? 'BATTLE ROYALE' : 'LÂY NHIỄM', fromId: 0, system: true, text: `${p.username} mất kết nối · giữ chỗ ${Math.round(REJOIN_GRACE_MS / 1000)} giây.` });
    } else {
      this.battle?.leave(p.id);
      this.infection?.leave(p.id);
      if (this.infection) this.infectionLoadouts.delete(p.id);
    }
    const saved = this.arena ? Promise.resolve() : p.questBusy
      ? new Promise<void>((resolve) => { p.onLeaveSaved = resolve; })
      : this.deps.playerStates
        .saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies }])
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
    if (this.battle && !['in', 'ping', 'ready', 'chat', 'inv', 'reload', 'heal', 'auth', 'door', 'vehicle', 'jumppoint'].includes(msg.t)) return;
    if (this.battle && this.battle.phase !== 'running' && ['inv', 'reload', 'heal'].includes(msg.t)) return;
    if (this.infection && !['in', 'ping', 'ready', 'chat', 'inv', 'reload', 'auth', 'door', 'loadout'].includes(msg.t)) return;
    if (this.infection && msg.t === 'inv' && msg.op !== 'equip') return;
    if (msg.t === 'loadout') { if (p && this.infection) this.onLoadout(p, msg); return; }
    if (p?.state.flight && ['inv', 'reload', 'heal', 'door'].includes(msg.t)) return;
    if (p && msg.t === 'tutorial') {
      updateTutorial(p, msg, this.serverTime);
      p.session.sendJson({ t: 'tutorialState', ...tutorialProgress(p) });
      return;
    }
    if (!p || p.questBusy) return;
    switch (msg.t) {
      case 'door': {
        const door = this.battleDoors.get(msg.id);
        if (!this.arena || !door || p.dead || p.downed || Math.hypot(p.state.x - door.x, p.state.z - door.z) > 3 || Math.abs(p.state.y - door.y) > 2) return;
        if (this.serverTime - (this.doorUsedAt.get(p.id) ?? -Infinity) < 250) return;
        this.doorUsedAt.set(p.id, this.serverTime);
        if (door.open && [...this.players.values()].some(other => {
          const dx = other.state.x - door.x, dz = other.state.z - door.z, c = Math.cos(door.yaw), s = Math.sin(door.yaw);
          return !other.dead && Math.abs(dx * c - dz * s) < .9 && Math.abs(dx * s + dz * c) < .7 && Math.abs(other.state.y - door.y) < 2;
        })) return;
        door.open = !door.open;
        this.collision.setOwnerColliders(0xb0000000 + msg.id, doorColliders(door));
        this.broadcast({ t: 'door', id: msg.id, ...door });
        return;
      }
      case 'vehicle':
        this.vehicles.toggle(p, msg.id, this.serverTime, (id) => { const other = this.players.get(id); return !!other && this.allied(p, other); });
        this.vehicles.send(p, this.serverTime);
        return;
      case 'ready':
        this.enterMatch(p);
        return;
      case 'pvp':
        if (p.dead || p.downed || p.pvpUntil <= this.serverTime) return;
        p.pvpEnabled = msg.enabled;
        this.sendPvp(p, this.serverTime);
        this.broadcastPlayerList();
        return;
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
        this.onChat(p, msg.text, msg.channel);
        return;
      case 'respawn':
        this.onRespawn(p);
        return;
      case 'inv':
        this.onInventory(p, msg);
        return;
      case 'build':
        this.onBuild(p, msg);
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
        if (!t || t === p || !t.downed || p.dead || p.downed || (this.battle && !this.battle.allies(p.id, t.id))) return;
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
      case 'jumppoint':
        // Remembered until the player leaves the plane; a negative point clears it.
        p.jumpPoint = msg.x < 0 || msg.z < 0 ? null : { x: msg.x, z: msg.z };
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
      // A backlog the server caused itself (a slow tick) is no sign of cheating.
      if (performance.now() - this.lastSlowTickAt > 2000) this.flag(p, 'input_overflow');
    }
    p.inputs.push(msg);
  }

  private onChat(p: Player, raw: string, channel: 'world' | 'team' = 'world'): void {
    const s = p.session;
    if (!s.chatBucket.take()) {
      this.flag(p, 'chat_spam');
      s.sendError('rate_limited', 'you are sending messages too quickly', false);
      return;
    }
    const text = sanitizeChat(raw);
    if (!text) return;
    if (/^\/vehicle(?:\s|$)/i.test(text)) {
      this.onCommand(p, text.slice(1).trim());
      return;
    }
    if (channel === 'team') {
      if (!this.deps.teams?.forAccount(p.accountId)) { this.reply(p, 'Bạn chưa tham gia đội.'); return; }
      void this.deps.teams.action(p.accountId, p.username, { op: 'chat', text }, p.rank).then(() => {
        for (const member of this.players.values()) if (member === p || this.allied(p, member)) this.sendTeam(member);
      }).catch((err: unknown) => this.reply(p, err instanceof Error ? err.message : 'Không gửi được tin nhắn đội.'));
      return;
    }
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
    this.broadcast({ t: 'chat', from: p.username, fromId: p.id, text, rank: p.rank });
  }

  /** Replies to one player only, as a greyed system line in their chat. */
  private reply(p: Player, text: string): void {
    p.session.sendJson({ t: 'chat', from: 'ZION', fromId: 0, text, system: true });
  }

  private onCommand(p: Player, line: string): void {
    const vehicleCommand = line.split(/\s+/);
    if (vehicleCommand[0]?.toLowerCase() === 'vehicle') {
      this.reply(p, this.vehicles.spawn(p, vehicleCommand[1], this.serverTime));
      this.vehicles.send(p, this.serverTime); return;
    }
    if (this.arena) { this.reply(p, 'Lệnh sinh tồn không dùng trong chế độ này.'); return; }
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
    if (this.arena) return;
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

  /** Places held for dropped players run out: they are out of the match. */
  private expireRejoins(now: number): void {
    for (const [account, r] of this.rejoins) {
      if (now < r.until && (!this.battle || this.battle.phase !== 'finished')) continue;
      this.rejoins.delete(account);
      this.battle?.leave(r.id);
      this.infection?.leave(r.id);
      this.infectionLoadouts.delete(r.id);
      this.broadcast({ t: 'chat', from: this.battle ? 'BATTLE ROYALE' : 'LÂY NHIỄM', fromId: 0, system: true, text: `${r.name} đã rời trận.` });
    }
  }

  private stepBattle(now: number): void {
    this.expireRejoins(now);
    const match = this.battle!;
    if (!this.players.size && !this.joiningAccounts.size && !this.rejoins.size && this.battleWasOccupied) {
      this.chests.reset(); this.battleChests.clear(); this.deathCrates.clear(); this.groundItems.clear(); this.coinDrops.clear();
      this.rounds.length = 0; this.grenades.length = 0; this.c4Charges.clear();
      this.battle = this.newBattleMatch();
      this.stats.clear();
      this.battleFlightStarted = false;
      this.bots?.clear(); this.nextBotAt = 0;
      this.scatterGroundLoot();
      this.doorUsedAt.clear();
      this.vehicles.reset();
      for (const [id, door] of this.battleDoors) { door.open = false; this.collision.setOwnerColliders(0xb0000000 + id, doorColliders(door)); }
      this.battleWasOccupied = false; return;
    }
    this.joinBots(match, now);
    match.tick(now, this.matchPlayers(now));
    // Vehicles exist only once everyone is on the ground: hidden in the lobby and the plane.
    const vehicles = match.phase === 'running' && match.startedAt !== null && now - match.startedAt >= BATTLE_FLIGHT.durationMs;
    if (vehicles !== this.vehicles.available) {
      if (!vehicles) for (const p of this.players.values()) if (p.vehicleId) this.vehicles.release(p);
      this.vehicles.available = vehicles;
    }
    if (match.startedAt !== null && !this.battleFlightStarted) {
      this.battleFlightStarted = true;
      for (const p of this.players.values()) { if (p.vehicleId) this.vehicles.release(p); p.state.flight = 1; p.state.grounded = false; p.inputs.length = 0; }
      this.bots?.board(now, match.circle);
    }
    if (match.startedAt !== null && match.phase === 'running') {
      const plane = battlePlaneAt(this.deps.world.generator.worldSize, now - match.startedAt);
      const size = this.deps.world.generator.worldSize, start = battlePlaneAt(size, 0), end = battlePlaneAt(size, BATTLE_FLIGHT.durationMs);
      const progress = 1 - plane.remainingMs / BATTLE_FLIGHT.durationMs;
      for (const p of this.players.values()) if (!p.dead && p.state.flight === 1) {
        Object.assign(p.state, { x: plane.x, y: plane.y - 2, z: plane.z, vx: size * .76 / 55, vy: 0, vz: size * .44 / 55, grounded: false });
        // A marked jump point leaves the plane once it passes the point's projection on the path.
        const mark = p.jumpPoint, dx = end.x - start.x, dz = end.z - start.z;
        const target = mark ? ((mark.x - start.x) * dx + (mark.z - start.z) * dz) / (dx * dx + dz * dz) : Infinity;
        if (plane.remainingMs === 0 || progress >= target) { p.state.flight = 2; p.jumpPoint = null; }
      }
    }
    if (this.bots) {
      const state = match.state(now);
      this.bots.step(now, this.tick, {
        phase: state.phase, circle: state.circle, nextCircle: state.nextCircle, shrinking: state.shrinking, remainingMs: state.remainingMs,
        plane: match.startedAt !== null && state.phase === 'running' ? battlePlaneAt(this.deps.world.generator.worldSize, now - match.startedAt) : null,
      }, [...this.players.values()]);
      // Bots wait in the lobby ring too.
      if (match.inLobby && match.lobby) for (const bot of this.bots.bots) if (!bot.dead && !bot.state.flight) keepInCircle(bot.state, match.lobby);
    }
    if (this.tick % TICK_RATE !== 0) return;
    if (match.phase === 'running') {
      // Safety net: an entrant with no living body (a bot gone, a player who left) is out.
      const living = new Set<number>();
      for (const p of this.players.values()) if (!p.dead) living.add(p.id);
      for (const bot of this.bots?.bots ?? []) if (!bot.dead) living.add(bot.id);
      for (const r of this.rejoins.values()) living.add(r.id);
      for (const id of match.entrants.keys()) if (!match.eliminated.has(id) && !living.has(id)) match.eliminate(id);
      for (const p of this.players.values()) if (!p.dead && match.outside(p.state.x, p.state.z)) {
        this.damage(null, p, match.state(now).damagePerSecond, 'red_zone', p.state.x, p.state.y + 1, p.state.z, now);
      }
      // Bots still falling or under a canopy (e.g. over unloaded ground) burn too: none outlives the zone.
      for (const bot of this.bots?.bots ?? []) if (!bot.dead && bot.state.flight !== 1 && match.outside(bot.state.x, bot.state.z)) {
        this.bots!.hit(bot, match.state(now).damagePerSecond, 'vòng bo đỏ', null, now, 'red_zone');
      }
    }
    for (const p of this.players.values()) p.session.sendJson({ ...match.state(now, p.id), drop: { phase: p.state.flight === 1 ? 'boarding' : p.state.flight === 2 ? 'falling' : p.state.flight === 3 ? 'parachute' : 'landed', altitude: Math.max(0, p.state.y - this.deps.world.generator.heightAt(p.state.x, p.state.z)), parachuteOpen: p.state.flight === 3 } });
    if (match.phase === 'finished' && match.state(now).remainingMs === 0) {
      this.rejoins.clear();
      for (const p of [...this.players.values()]) { this.leave(p.session, 'battle finished'); p.session.close(CloseCode.Normal, 'Trận đã kết thúc'); }
    }
  }

  /** Loose weapons, ammunition, armour and kits lying on building floors for each new match. */
  private scatterGroundLoot(): void {
    const spots = authoredWorld(this.deps.world.generator).lootSpots();
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spots[i], spots[j]] = [spots[j]!, spots[i]!]; }
    for (const spot of spots.slice(0, Math.min(320, Math.floor(spots.length * .35)))) {
      const pool = generateBattleLoot([]), item = pool[Math.floor(Math.random() * pool.length)]!;
      const id = this.nextGroundId++;
      this.groundItems.set(id, { itemId: item.itemId, count: item.count, mag: item.mag, x: +(spot.x + (Math.random() - .5) * 1.2).toFixed(2), y: +spot.y.toFixed(2), z: +(spot.z + (Math.random() - .5) * 1.2).toFixed(2), expiresAt: Infinity });
    }
  }

  /** While a match fills up, bots join one by one behind the human players (at most MAX_BATTLE_BOTS). */
  private joinBots(match: BattleRoyaleMatch, now: number): void {
    if (!this.bots || !match.accepting) return;
    const humans = [...this.players.values()].filter(p => !p.dead);
    // Squad matches: three bot squads of the match's squad size; solo: up to MAX_BATTLE_BOTS.
    const size = match.squadSize, limit = size > 1 ? size * 3 : MAX_BATTLE_BOTS;
    if (!humans.length) return;
    // Right before the drop, every empty place in the match is filled with bots (whole squads).
    const filling = match.phase === 'countdown' && match.state(now).remainingMs < 3000;
    if (filling) {
      let added = 0;
      while (match.accepting && this.bots.bots.length < 400 && this.addBot(match, humans, size)) added++;
      if (added) this.broadcastPlayerList();
      return;
    }
    if (this.bots.bots.length >= limit) return;
    if (!this.nextBotAt) { this.nextBotAt = now + 800; return; }
    if (now < this.nextBotAt) return;
    const bot = this.addBot(match, humans, size);
    if (!bot) return;
    this.nextBotAt = now + 800 + Math.random() * 1400;
    this.broadcastPlayerList();
    this.broadcast({ t: 'chat', from: 'BATTLE ROYALE', fromId: 0, system: true, text: `${bot.name} đã tham gia trận.` });
  }

  /** One more bot in the match: squads fill in order, each with a lead, a gunner and a looter. */
  private addBot(match: BattleRoyaleMatch, humans: readonly Player[], size: number): BattleBot | null {
    const near = humans[Math.floor(Math.random() * humans.length)]!;
    const bot = this.bots!.spawn(near.state.x, near.state.y, near.state.z);
    const index = this.bots!.bots.length - 1, squad = size > 1 ? `bot-squad-${Math.floor(index / size)}` : null;
    if (!match.join(bot.id, bot.name, squad ? { id: squad, name: BOT_SQUAD_NAMES[Math.floor(index / size) % BOT_SQUAD_NAMES.length]!, size } : undefined)) { this.bots!.bots.pop(); return null; }
    bot.squad = squad;
    bot.role = size > 1 ? (['lead', 'gunner', 'looter'] as const)[index % size] ?? 'gunner' : 'lead';
    return bot;
  }


  /* ------------------------------------ infection ---------------------------------------- */

  /** Open ground on the infection map, spread round the town (checked against collision). */
  private infectionSpot(zombie = false): ValidatedPosition {
    const gen = this.deps.world.generator, spots = zombie ? infectionZombieSpawns(gen) : infectionSpawns(gen);
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[(this.infectionSpawnIndex++ * 7) % spots.length]!;
      // A point placed in 3D (on a floor of the map model) spawns on that floor.
      const pos = this.spawns.validateAt(spot.x + (Math.random() - .5) * (spot.y !== undefined ? 1 : 3), spot.z + (Math.random() - .5) * (spot.y !== undefined ? 1 : 3), false, spot.y);
      if (pos) return pos;
    }
    const spot = spots[Math.floor(Math.random() * spots.length)]!;
    return { x: spot.x, y: this.deps.world.generator.heightAt(spot.x, spot.z) + .05, z: spot.z };
  }

  /** A loaded player joins the battle or the infection round (once). */
  private enterMatch(p: Player): void {
    const pending = p.pendingMatch;
    if (!pending) return;
    p.pendingMatch = null;
    if (this.battle) { this.battle.join(p.id, p.username, pending.squad); this.broadcastPlayerList(); }
    if (this.infection) { this.infection.join(p.id, p.username); this.syncLoadout(p); this.broadcastPlayerList(); }
  }

  /** Players in matchmaking (loaded); still-loading ones wait outside it (2 min at most). */
  private matchPlayers(now: number): number {
    let n = 0;
    for (const p of this.players.values()) {
      if (p.pendingMatch && now - p.pendingMatch.since > 120_000) this.enterMatch(p);
      if (!p.pendingMatch) n++;
    }
    return n;
  }

  /** Human gear: the chosen loadout, full magazines, fresh throwables. */
  private makeHuman(p: Player): void {
    p.cancelReload();
    p.inv.load(infectionInventory(this.infectionLoadouts.get(p.id) ?? DEFAULT_INFECTION_LOADOUT));
    p.health = PLAYER_MAX_HEALTH;
    this.syncLoadout(p); this.sendInv(p);
  }

  /** Zombie: an axe and nothing else; the body stands up out of any stance. */
  private makeZombie(p: Player): void {
    p.cancelReload();
    p.inv.load(zombieInventory());
    p.health = PLAYER_MAX_HEALTH;
    p.state.prone = false; p.state.crouched = false; p.aiming = false; p.bandaging = false;
    this.syncLoadout(p); this.sendInv(p);
  }

  /** Back on the map at a spawn point, alive, as a human or a zombie. */
  private infectionPlace(p: Player, zombie: boolean): void {
    const pos = this.infectionSpot(zombie);
    this.teleport(p, pos);
    p.dead = false; p.downed = false; p.killerId = null; p.state.pushX = 0; p.state.pushZ = 0;
    if (zombie) this.makeZombie(p); else this.makeHuman(p);
    this.broadcastNear(p, { t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
    p.session.sendJson({ t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
  }

  private onLoadout(p: Player, msg: { primary: string; secondary: string; melee: string }): void {
    const loadout = sanitizeInfectionLoadout(msg);
    this.infectionLoadouts.set(p.id, loadout);
    // Before the outbreak a living human swaps gear on the spot.
    const m = this.infection!;
    if (!p.dead && !m.isZombie(p.id) && (m.phase !== 'running' || !m.joinsAsZombie)) this.makeHuman(p);
  }

  /** Turned: a human becomes a zombie where they stand. */
  private turnPlayer(t: Player, attackerId: number | null): void {
    const m = this.infection!;
    if (m.isZombie(t.id)) return;
    m.infect(t.id);
    this.makeZombie(t);
    const by = attackerId === null ? undefined : this.players.get(attackerId)?.username ?? this.bots?.bots.find((b) => b.id === attackerId)?.name;
    this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: by ? `${t.username} đã bị ${by} lây nhiễm!` : `${t.username} đã hóa zombie!` });
    this.broadcastInfection();
  }

  /** Where an attacker stands (player or bot). */
  private combatantAt(id: number | null): { x: number; z: number } | null {
    if (id === null) return null;
    return this.players.get(id)?.state ?? this.bots?.bots.find((b) => b.id === id)?.state ?? null;
  }

  /** Shoved back along the shot, on top of the zombie's own movement (it keeps steering). */
  private shove(state: CharacterState, from: { x: number; z: number } | null, x: number, z: number, amount: number): { kx: number; kz: number; force: number } | undefined {
    if (!from) return undefined;
    const dx = state.x - from.x, dz = state.z - from.z, l = Math.hypot(dx, dz) || 1;
    const k = Math.min(this.infectionRules.knockMax, amount * this.infectionRules.knockPerDamage);
    let px = (state.pushX ?? 0) + dx / l * k, pz = (state.pushZ ?? 0) + dz / l * k;
    const m = Math.hypot(px, pz);
    if (m > this.infectionRules.knockMax) { px *= this.infectionRules.knockMax / m; pz *= this.infectionRules.knockMax / m; }
    state.pushX = px; state.pushZ = pz;
    void x; void z;
    return { kx: +(dx / l).toFixed(3), kz: +(dz / l).toFixed(3), force: +k.toFixed(2) };
  }

  /**
   * Infection damage to a player: a zombie's blow turns a human at once; zombies soak bullets
   * (health scaled by this.infectionRules.zombieHealth) and are shoved back by every hit.
   */
  private infectionDamage(attackerId: number | null, t: Player, amount: number, zone: string, x: number, y: number, z: number, now: number, weapon?: number | string): void {
    const m = this.infection!;
    if (!m.canFight(t.id) || t.dead) return;
    const fromZombie = attackerId !== null && m.isZombie(attackerId);
    if (!m.isZombie(t.id)) {
      if (attackerId !== null && attackerId !== t.id && !fromZombie) return;
      this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: fromZombie ? PLAYER_MAX_HEALTH : amount, x, y, z });
      if (fromZombie) { this.turnPlayer(t, attackerId); return; }
      t.health = Math.max(0, t.health - amount); t.dirty = true;
      if (t.health <= 0) this.turnPlayer(t, null);
      return;
    }
    if (fromZombie) return;
    const knock = zone === 'fall' ? undefined : this.shove(t.state, this.combatantAt(attackerId), x, z, amount);
    t.health = Math.max(0, t.health - amount * PLAYER_MAX_HEALTH / this.infectionRules.zombieHealth); t.dirty = true;
    this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: amount, x, y, z, ...knock });
    if (t.health <= 0) this.killPlayer(t, attackerId, now, weapon);
  }

  /** Infection damage to a bot (from a player, a bot or a blast). */
  private infectionBotDamage(bot: BattleBot, amount: number, attackerId: number | null, from: { x: number; z: number } | null, zone: string, now: number): void {
    const m = this.infection!;
    if (bot.dead || !m.canFight(bot.id) || amount <= 0) return;
    const fromZombie = attackerId !== null && m.isZombie(attackerId);
    if (!bot.zombie) {
      if (!fromZombie) return;
      this.broadcastAt(bot.state.x, bot.state.z, { t: 'hit', attackerId: attackerId ?? 0, targetId: bot.id, zone, damage: PLAYER_MAX_HEALTH, x: bot.state.x, y: bot.state.y + 1.2, z: bot.state.z });
      m.infect(bot.id);
      this.dressBot(bot, true);
      const by = this.players.get(attackerId!)?.username ?? this.bots?.bots.find((b) => b.id === attackerId)?.name;
      this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: `${bot.name} đã bị ${by ?? 'zombie'} lây nhiễm!` });
      this.broadcastInfection();
      return;
    }
    if (fromZombie) return;
    const knock = this.shove(bot.state, from, bot.state.x, bot.state.z, amount);
    bot.health = Math.max(0, bot.health - amount * 100 / this.infectionRules.zombieHealth);
    if (from) bot.alert = { x: from.x, z: from.z, until: now + 6000 };
    this.broadcastAt(bot.state.x, bot.state.z, { t: 'hit', attackerId: attackerId ?? 0, targetId: bot.id, zone, damage: amount, x: bot.state.x, y: bot.state.y + 1.2, z: bot.state.z, ...knock });
    if (bot.health > 0) return;
    bot.dead = true; bot.deadAt = now; bot.target = null;
    m.respawnAt.set(bot.id, now + this.infectionRules.zombieRespawnMs);
    this.broadcastAt(bot.state.x, bot.state.z, { t: 'death', playerId: bot.id, killerId: attackerId });
    const by = attackerId === null ? undefined : this.players.get(attackerId)?.username ?? this.bots?.bots.find((b) => b.id === attackerId)?.name;
    this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: by ? `${by} đã hạ zombie ${bot.name}.` : `Zombie ${bot.name} đã gục.` });
    this.broadcastInfection();
  }

  /** Gear and team for a bot: a random gun pair as a human, the axe as a zombie. */
  private dressBot(bot: BattleBot, zombie: boolean): void {
    const pick = (list: string[], fallback: string) => list.length ? list[Math.floor(Math.random() * list.length)]! : fallback;
    const loadout = { primary: pick(infectionChoices('primary'), DEFAULT_INFECTION_LOADOUT.primary), secondary: pick(infectionChoices('secondary'), DEFAULT_INFECTION_LOADOUT.secondary), melee: DEFAULT_INFECTION_LOADOUT.melee };
    const inv = zombie ? zombieInventory() : infectionInventory(loadout);
    Object.assign(bot, {
      zombie, squad: zombie ? 'infection-zombies' : 'infection-humans', health: 100, dead: false, downed: false, target: null, mode: 'idle', goal: null,
      reloadUntil: 0, alert: null, campUntil: 0, healUntil: 0, infiniteAmmo: !zombie, speedMul: zombie ? this.infectionRules.zombieSpeed : 1, jumpMul: zombie ? this.infectionRules.zombieJump : 1,
      items: inv.items.map((i) => ({ ...i })),
    });
    bot.gunItem = zombie ? null : bot.items.find((i) => i.container === 'primary') ?? null;
    bot.weapon = bot.gunItem ? WEAPON_BY_ITEM[bot.gunItem.itemId] ?? 0 : 0;
    bot.meleeItem = bot.items.find((i) => i.container === 'heavy') ?? null;
    bot.state.prone = false;
  }

  private placeBot(bot: BattleBot): void {
    const pos = this.infectionSpot(bot.zombie);
    Object.assign(bot.state, { x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, pushX: 0, pushZ: 0, prone: false, crouched: false, flight: 0, grounded: false });
    bot.yaw = Math.random() * Math.PI * 2;
  }

  private broadcastInfection(): void {
    const m = this.infection!, now = this.serverTime;
    for (const p of this.players.values()) p.session.sendJson(m.state(now, p.id));
  }

  /** High ground of the map once worked out (shared by every match on the same world). */
  private holdSpots(): HoldSpot[] {
    const gen = this.deps.world.generator;
    if (!HOLD_SPOTS.has(gen)) { HOLD_SPOTS.set(gen, []); void this.prepareHoldSpots().catch((err: unknown) => this.log.error({ err }, 'hold spots failed')); }
    return HOLD_SPOTS.get(gen)!;
  }

  /** Loads the map's physics, then keeps the high spots a walker can actually reach from the streets. */
  private async prepareHoldSpots(): Promise<void> {
    const gen = this.deps.world.generator, c = Math.floor(this.infectionCentre / CHUNK_SIZE);
    await this.physics.ensureArea(c, c, Math.ceil((this.infectionMap.half + 8) / CHUNK_SIZE));
    const map = new WalkingMap(this.collision), spawns = infectionSpawns(gen);
    // Ladders: bots (and the reachability check) can climb them.
    const ladders = this.ladderPortals();
    map.portals = ladders;
    this.bots?.setPortals(ladders);
    // Searched a slice at a time between ticks: the simulation never stalls for it.
    let sliceStart = performance.now();
    const pause = async () => { if (performance.now() - sliceStart > 8) { await new Promise<void>((r) => setTimeout(r, 0)); sliceStart = performance.now(); } };
    const kept: HoldSpot[] = [];
    for (const spot of this.highSpots()) {
      // From the nearest open spawn points (a spawn spot may sit on clutter; validated ones do not).
      const near = spawns.slice().sort((a, b) => Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(b.x - spot.x, b.z - spot.z)).slice(0, 2);
      for (const sp of near) {
        const from = this.spawns.validateAt(sp.x, sp.z);
        if (!from) continue;
        const search = new WalkingSearch(map, { x: from.x, y: from.y + .01, z: from.z }, spot.tiles[0]!, 25_000);
        for (let n = 0; !search.done && n < 30_000;) { n += search.advance(150); await pause(); }
        if (search.path.length) { kept.push({ ...spot, route: [{ x: from.x, y: from.y + .01, z: from.z }, ...search.path] }); break; }
      }
    }
    HOLD_SPOTS.set(gen, kept);
    this.log.info({ spots: kept.length }, 'infection high ground ready');
  }

  /**
   * High ground worth holding on this map: upper floors and roof terraces of buildings with
   * stairs, one spot per building level (its floor tiles, nearest the middle first), highest first.
   */
  private highSpots(): HoldSpot[] {
    const levels = new Map<string, Array<{ x: number; y: number; z: number }>>();
    for (const site of allStructures(this.deps.world.generator)) {
      const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
      for (const part of site.parts) {
        // Building floors and flat roofs (3.2 m storeys: modular blocks and street houses).
        const street = part.asset === STREET_ASSET.slab || part.asset === STREET_ASSET.roof;
        const storey = street ? part.y / 3.2 : (part.y - .24) / 3.2;
        if ((part.asset !== BRIDGE_ASSET.woodenDeck && !street) || part.scale !== 1 || part.y < 2.5 || Math.abs(storey - Math.round(storey)) > .02) continue;
        const key = `${site.gid}:${part.group ?? 0}:${Math.round(part.y)}`, l = levels.get(key) ?? [];
        // Stand on a real floor tile (its centre), never a centroid that may fall in the stairwell.
        l.push({ x: site.x + part.x * c + part.z * sn, y: site.y + part.y + (street ? STREET_KIT.slab + .02 : .15), z: site.z - part.x * sn + part.z * c });
        levels.set(key, l);
      }
    }
    const free = (t: { x: number; y: number; z: number }) => !!this.spawns && this.controller.isFree(t.x, t.y, t.z);
    // One spot per building: its highest level (the roof terrace when it has one).
    const best = new Map<string, Array<{ x: number; y: number; z: number }>>();
    for (const [key, l] of levels) {
      const building = key.slice(0, key.lastIndexOf(':'));
      if (l.length >= 3 && (!best.has(building) || best.get(building)![0]!.y < l[0]!.y)) best.set(building, l);
    }
    return [...best.values()].flatMap((l) => {
      const cx = l.reduce((n, t) => n + t.x, 0) / l.length, cz = l.reduce((n, t) => n + t.z, 0) / l.length;
      const tiles = l.filter(free).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      return tiles.length ? [{ ...tiles[0]!, tiles }] : [];
    }).sort((a, b) => b.y - a.y).slice(0, 14);
  }

  /**
   * Wall ladders as climbable links: the foot (on the ground in front) and the top (on the roof
   * or platform behind the top rung), found by looking down at both ends.
   */
  private ladderPortals(): Array<{ a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }> {
    const columns = new Map<string, { x: number; z: number; yaw: number; top: number; base: number }>();
    for (const site of allStructures(this.deps.world.generator)) {
      const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
      for (const part of site.parts) {
        if (part.asset !== CAMP_IDS['rusty-iron-wall-ladder']) continue;
        const x = site.x + part.x * c + part.z * sn, z = site.z - part.x * sn + part.z * c, key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
        const col = columns.get(key) ?? { x, z, yaw: part.yaw + site.yaw, top: -Infinity, base: Infinity };
        col.top = Math.max(col.top, site.y + part.y + 2 * part.scale); col.base = Math.min(col.base, site.y + part.y);
        columns.set(key, col);
      }
    }
    const hit = makeRayHit(), out: Array<{ a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }> = [];
    for (const col of columns.values()) {
      // The wall is behind the ladder (local −Z of the rungs); the climber stands in front.
      const wx = -Math.sin(col.yaw), wz = -Math.cos(col.yaw);
      const foot = { x: col.x - wx * .6, z: col.z - wz * .6 }, top = { x: col.x + wx * .9, z: col.z + wz * .9 };
      if (!this.collision.raycast(foot.x, col.base + 1.5, foot.z, 0, -1, 0, 4, Mask.CharacterMovement, hit)) continue;
      const fy = hit.y + .02;
      if (!this.collision.raycast(top.x, col.top + .5, top.z, 0, -1, 0, 3, Mask.CharacterMovement, hit) || hit.y < fy + 2) continue;
      out.push({ a: { x: foot.x, y: fy, z: foot.z }, b: { x: top.x, y: hit.y + .02, z: top.z } });
    }
    return out;
  }

  /** Infection humans (bots): about four escort the real players; the rest form groups of 3–5 on high ground. */
  private groupInfectionBots(): void {
    if (!this.bots) return;
    const all = (this.bots?.bots ?? []).filter((b) => !b.dead && !b.zombie);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j]!, all[i]!]; }
    const people = [...this.players.values()].filter((p) => !p.dead && !this.infection?.isZombie(p.id));
    const escorts = people.length ? all.splice(0, Math.min(4, all.length)) : [];
    escorts.forEach((bot, k) => {
      const p = people[k % people.length]!;
      bot.follow = p.id; bot.holdAt = null; bot.squad = `infection-escort-${p.id}`; bot.role = 'gunner';
      bot.followSlot = k;
    });
    for (const bot of all) bot.follow = null;
    const humans = all;
    const spots = this.holdSpots();
    let g = 0;
    const taken = new Set<{ x: number; y: number; z: number }>();
    for (let i = 0; i < humans.length; g++) {
      // Groups of 3–5 that never leave a group smaller than three behind (fewer than 3 in all: one group).
      const left = humans.length - i, size = left <= 5 ? left : left <= 10 ? Math.ceil(left / 2) : Math.min(5, left - 3, 3 + Math.floor(Math.random() * 3));
      const group = humans.slice(i, i + size); i += size;
      // No high ground on this map: the group still sticks together round a spawn point.
      const spawn = infectionSpawns(this.deps.world.generator)[g % Math.max(1, infectionSpawns(this.deps.world.generator).length)]!;
      // The group's nearest high spot not taken yet (spread over the map when there are enough).
      const cx = group.reduce((n, b) => n + b.state.x, 0) / group.length, cz = group.reduce((n, b) => n + b.state.z, 0) / group.length;
      const free = spots.filter((p) => !taken.has(p)), best = (free.length ? free : spots).slice().sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
      if (best) taken.add(best);
      const spot = best ?? { x: spawn.x, y: this.deps.world.generator.heightAt(spawn.x, spawn.z), z: spawn.z };
      const fx = spot.x - this.infectionCentre || 1, fz = spot.z - this.infectionCentre, fl = Math.hypot(fx, fz) || 1;
      const tiles = 'tiles' in spot ? spot.tiles : [];
      group.forEach((bot, k) => {
        const a = k / group.length * Math.PI * 2, r = group.length > 1 ? 1.4 : 0, tile = tiles[k % Math.max(1, tiles.length)];
        bot.squad = `infection-group-${g}`;
        bot.role = k === 0 ? 'lead' : k === 1 ? 'gunner' : 'looter';
        // Each one faces a different way out, so the group covers every approach.
        // The route up is known: walk it (the last stretch to this bot's own tile is short).
        bot.holdRoute = 'route' in spot && spot.route ? spot.route.map((p) => ({ ...p })) : [];
        bot.holdAt = { x: tile ? tile.x : spot.x + Math.cos(a) * r, y: tile ? tile.y : spot.y, z: tile ? tile.z : spot.z + Math.sin(a) * r, faceX: Math.cos(a + Math.atan2(fz / fl, fx / fl)), faceZ: Math.sin(a + Math.atan2(fz / fl, fx / fl)) };
      });
    }
  }

  /** Bots keep the room at this.infectionRules.botFill entrants while someone is playing. */
  private fillInfectionBots(m: InfectionMatch): void {
    if (!this.bots) return;
    if (!this.players.size) {
      if (this.bots.bots.length) { for (const bot of this.bots.bots) m.leave(bot.id); this.bots.clear(); this.broadcastPlayerList(); }
      return;
    }
    // Bots take empty places once the first countdown starts (never while the lobby gathers), up
    // to botFill, which leaves room for late real players; they need the countdown to take cover.
    if (m.phase !== 'countdown' || m.round !== 1) return;
    let added = 0;
    while (m.entrants.size < this.infectionRules.botFill && m.accepting) {
      const bot = this.bots.spawn(this.infectionCentre, INFECTION_GROUND, this.infectionCentre);
      if (!m.join(bot.id, bot.name)) { this.bots.bots.pop(); break; }
      this.dressBot(bot, m.isZombie(bot.id));
      this.placeBot(bot);
      added++;
    }
    if (added) { this.groupInfectionBots(); this.broadcastPlayerList(); }
  }

  private stepInfection(now: number): void {
    // Everyone left: the server is a fresh lobby for the next match.
    this.expireRejoins(now);
    if (!this.players.size && !this.joiningAccounts.size && !this.rejoins.size && this.infectionOccupied) {
      this.infection = new InfectionMatch(this.infectionRules, this.infectionMap.name);
      this.bots?.clear(); this.infectionLoadouts.clear(); this.infectionOccupied = false;
      this.rounds.length = 0; this.grenades.length = 0;
      for (const [id, door] of this.battleDoors) { door.open = false; this.collision.setOwnerColliders(0xb0000000 + id, doorColliders(door)); }
      return;
    }
    const m = this.infection!;
    this.fillInfectionBots(m);
    const ev = m.tick(now, this.matchPlayers(now));
    const bots = this.bots?.bots ?? [];
    if (ev.reset) {
      for (const p of this.players.values()) this.infectionPlace(p, false);
      for (const bot of bots) { this.dressBot(bot, false); this.placeBot(bot); }
      this.groupInfectionBots();
      for (const [id, door] of this.battleDoors) { door.open = false; this.collision.setOwnerColliders(0xb0000000 + id, doorColliders(door)); this.broadcast({ t: 'door', id, ...door }); }
      this.rounds.length = 0; this.grenades.length = 0;
      this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: `Vòng ${m.round} · ${this.infectionMap.name}: chọn vũ khí, tìm chỗ nấp. Mầm bệnh sẽ bùng phát sau khi trận bắt đầu!` });
    }
    if (ev.outbreak?.length) {
      for (const id of ev.outbreak) {
        const p = this.players.get(id);
        if (p) { if (p.dead) this.infectionPlace(p, true); else this.makeZombie(p); continue; }
        const bot = bots.find((b) => b.id === id);
        if (bot) this.dressBot(bot, true);
      }
      const names = ev.outbreak.map((id) => m.entrants.get(id) ?? '?').join(', ');
      this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: `Mầm bệnh bùng phát! ${names} đã hóa zombie.` });
    }
    if (ev.finished) this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: ev.finished === 'humans' ? 'Con người đã cầm cự tới bình minh. Con người thắng!' : 'Không còn ai sống sót. Zombie thắng!' });
    if (ev.reset || ev.outbreak?.length || ev.finished) this.broadcastInfection();
    if (ev.over) {
      this.broadcastInfection();
      this.rejoins.clear();
      for (const p of [...this.players.values()]) { this.leave(p.session, 'match over'); p.session.close(CloseCode.Normal, 'Trận đã kết thúc'); }
      return;
    }
    for (const [id, at] of m.respawnAt) {
      if (now < at) continue;
      m.respawnAt.delete(id);
      const p = this.players.get(id);
      if (p) { this.infectionPlace(p, m.isZombie(id)); continue; }
      const bot = bots.find((b) => b.id === id);
      if (bot) { this.dressBot(bot, m.isZombie(id)); this.placeBot(bot); }
    }
    // No stamina in this mode: run and swing as long as you like.
    for (const p of this.players.values()) p.life.stamina = p.life.capacity;
    if (this.bots) {
      const circle = { x: this.infectionCentre, z: this.infectionCentre, radius: this.infectionMap.half - 6 };
      this.bots.step(now, this.tick, { phase: m.phase, circle, nextCircle: circle, shrinking: false, remainingMs: 1e9, plane: null }, [...this.players.values()]);
    }
    if (this.tick % TICK_RATE === 0) this.broadcastInfection();
  }

  /** The current match's lobby ring, picked once (an open patch of ground) when the first player comes. */
  private battleLobby: Promise<BattleCircle> | null = null;
  private pickBattleLobby(): Promise<BattleCircle> {
    const match = this.battle!;
    this.battleLobby ??= (async () => {
      let best: { pos: { x: number; z: number }; open: number } | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const pos = await this.spawns.pickSpawn();
        let open = 0;
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2;
          if (await this.spawns.validateLoaded(pos.x + Math.cos(a) * BATTLE_LOBBY_RADIUS * .8, pos.z + Math.sin(a) * BATTLE_LOBBY_RADIUS * .8, true)) open++;
        }
        if (!best || open > best.open) best = { pos, open };
        if (open >= 7) break;
      }
      match.lobby = { x: best!.pos.x, z: best!.pos.z, radius: BATTLE_LOBBY_RADIUS };
      return match.lobby;
    })();
    return this.battleLobby;
  }
  /** A free spot inside the lobby ring for someone joining (the ring's centre if none is open). */
  private async lobbySpot(fallback: { x: number; y: number; z: number }): Promise<{ x: number; y: number; z: number }> {
    const ring = await this.pickBattleLobby();
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * ring.radius * .7;
      const pos = await this.spawns.validateLoaded(ring.x + Math.cos(a) * d, ring.z + Math.sin(a) * d, true);
      if (pos && ![...this.players.values()].some((p) => Math.hypot(p.state.x - pos.x, p.state.z - pos.z) < 1.2)) return pos;
    }
    return (await this.spawns.validateLoaded(ring.x, ring.z)) ?? fallback;
  }

  /** Every match draws its own zone sequence over land. */
  private newBattleMatch(): BattleRoyaleMatch {
    this.battleLobby = null;
    const gen = this.deps.world.generator;
    return new BattleRoyaleMatch((Math.random() * 0x7fffffff) | 0, gen.worldSize, (x, z) => gen.heightAt(x, z) > gen.seaLevel + .5);
  }
  private botDied(bot: BattleBot, by: string, now: number, killerId: number | null = null): void {
    this.credit(killerId, bot.id);
    this.battle?.eliminate(bot.id);
    this.broadcastAt(bot.state.x, bot.state.z, { t: 'death', playerId: bot.id, killerId });
    this.broadcast({ t: 'chat', from: 'BATTLE ROYALE', fromId: 0, system: true, text: `${bot.name} đã bị loại bởi ${by}.` });
    if (!bot.items.length) return;
    const items = bot.items.map(item => ({ ...item, container: 'backpack' as const, x: 0, y: 0 }));
    const id = `9999:${bot.id}:${Math.round(now)}:0`;
    this.battleChests.set(id, { items, searched: true, revision: 0, capacity: Math.max(24, items.length) });
    this.deathCrates.set(id, { id, x: bot.state.x, y: bot.state.y, z: bot.state.z });
    bot.items = [];
    this.broadcast({ t: 'lootCrates', crates: [...this.deathCrates.values()] });
  }

  /** Battle chests and death crates around a point, for the bots. */
  private battleChestsNear(x: number, z: number, radius: number): Array<{ id: string; x: number; y: number; z: number }> {
    const out: Array<{ id: string; x: number; y: number; z: number }> = [];
    for (const crate of this.deathCrates.values()) if (Math.hypot(crate.x - x, crate.z - z) <= radius) out.push(crate);
    const r = Math.ceil(radius / CHUNK_SIZE), cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const chunk = this.deps.world.peek(cx + dx, cz + dz, 0)?.data;
      if (!chunk) continue;
      for (const prop of chunk.props) {
        if (!CHEST_ASSETS.has(prop.asset)) continue;
        const t = propTransform(chunk, prop);
        if (Math.hypot(t.x - x, t.z - z) <= radius) out.push({ id: chestKey(prop.asset, t.x, t.y, t.z), x: t.x, y: t.y, z: t.z });
      }
    }
    return out;
  }

  /** A bot empties what it wants from a chest, generating its battle loot first if nobody has. */
  private botLoot(id: string, choose: (items: readonly PlacedItem[]) => number[]): PlacedItem[] {
    const live = this.chests.takeLive(id, choose);
    if (live) return live;
    const data = this.battleChests.get(id) ?? { items: [], searched: false, revision: 0 };
    if (!data.searched) { data.items = generateBattleLoot(data.items); data.searched = true; }
    const take = new Set(choose(data.items));
    const taken = data.items.filter(i => take.has(i.uid));
    this.battleChests.set(id, { ...data, items: data.items.filter(i => !take.has(i.uid)), revision: data.revision + 1 });
    return taken;
  }

  private step(): void {
    const t0 = performance.now();
    this.tick++;
    this.worldTimeMs += TICK_MS;
    const now = this.serverTime;
    if (this.battle) this.stepBattle(now);
    if (this.infection) this.stepInfection(now);

    this.chests.step();

    if (!this.lifeBusy && this.life.expireCoals(this.lifeWorld, Date.now())) {
      for (const p of this.players.values()) this.sendLife(p);
    }

    if (!this.lifeBusy && this.life.growth(this.lifeWorld, Date.now())) {
      for (const p of this.players.values()) this.sendLife(p);
    }
    for (const p of this.players.values()) {
      if (!p.active || p.questBusy) continue;
      if (p.pvpUntil && (now >= p.pvpUntil || p.dead || p.downed)) {
        p.pvpUntil = 0;
        p.pvpEnabled = false;
        this.sendPvp(p, now);
        this.broadcastPlayerList();
      } else if (p.pvpUntil && Math.ceil((p.pvpUntil - now) / 1000) !== p.pvpLastSecond) this.sendPvp(p, now);
      const retry = this.requisitionRetries.get(p.accountId);
      if (retry !== undefined && Date.now() >= retry) { void this.receiveStudioCurrency(p.accountId); continue; }
      if (p.questEvents.length) { void this.flushQuestEvents(p); if (p.questBusy) continue; }
      if (p.dead) {
        if (this.squadOf(p)) this.deps.teams?.position(p.accountId, { entityId: p.id, x: p.state.x, y: p.state.y, z: p.state.z, health: 0, downed: false });
        if (this.battle && this.tick % 6 === 0) {
          // Eliminated: the world streams around the teammate being spectated.
          // Squads watch a living teammate; solo players the one who killed them (while alive).
          const mate = [...this.players.values()].find((q) => q !== p && !q.dead && this.battle!.allies(p.id, q.id));
          const killer = p.killedBy === null ? undefined : this.players.get(p.killedBy) ?? this.bots?.bots.find((b) => b.id === p.killedBy);
          const watch = mate ?? (killer && !killer.dead ? killer : undefined);
          p.viewFrom = watch ? { x: watch.state.x, z: watch.state.z } : null;
          this.grid.update(p); p.streamer.setCenter(p.chunkX, p.chunkZ);
          this.sendTeam(p);
        } else if (this.tick % TICK_RATE === 0) this.sendTeam(p);
        // Dead players' inputs are acknowledged but ignored.
        const last = p.inputs[p.inputs.length - 1];
        if (last) p.lastProcessedSeq = last.s;
        p.inputs.length = 0;
        continue;
      }
      if (p.lifeAction && Math.hypot(p.state.x - p.lifeAction.x, p.state.z - p.lifeAction.z) > 0.05) this.cancelLifeAction(p);
      if (p.lifeAction && Date.now() >= p.lifeAction.end && !this.lifeBusy) {
        const a = p.lifeAction;
        this.cancelLifeAction(p, false);
        void this.commitLife(p, { t: 'life', op: a.kind, target: a.target, choice: a.choice }, true, a.cookBatch);
      }
      if (p.questBusy) continue;
      if (!(p.lastButtons & Buttons.Sprint)) this.life.rest(p.life, TICK_DT);
      if (this.tick % TICK_RATE === 0) p.session.sendJson({ t: 'baseLife', ...this.lifeStats(p) });
      if (p.suspendedZombies.length && now >= p.nextEncounterRestoreAt) {
        p.nextEncounterRestoreAt = now + 1000;
        this.zombies.restore(p);
      }
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
      if (!this.arena && this.tick % TICK_RATE === 0) {
        this.resolveQuestLocations(p);
        this.queueQuestEvent(p, { type: 'visit', x: p.state.x, z: p.state.z });
      }
      p.history.push(now, p.state.x, p.state.y, p.state.z, p.yaw, p.state.prone, !!p.vehicleId, !!p.state.crouched, leanOf(p.lastButtons));
      this.grid.update(p);
      p.streamer.setCenter(p.chunkX, p.chunkZ);
      if (this.squadOf(p)) this.deps.teams?.position(p.accountId, { entityId: p.id, x: p.state.x, y: p.state.y, z: p.state.z, health: p.dead ? 0 : p.health, downed: p.downed, yaw: p.yaw });
      // Squads in battle royale track each other on the map several times a second.
      if (this.battle && this.tick % 6 === 0 && this.tick % TICK_RATE !== 0) this.sendTeam(p);
      if (this.tick % TICK_RATE === 0) {
        this.sendTeam(p);
        void this.deps.teams?.progress(p.accountId).catch((err: unknown) => this.log.error({ err }, 'team rally progress failed'));
      }
    }

    this.vehicles.step(now, TICK_DT, this.players, (v, occupants) => {
      for (const occupant of occupants) if (!occupant.dead) this.killPlayer(occupant, null, now, 'xe phát nổ');
      this.collision.removeOwnerColliders(vehicleOwner(v.id));
      this.explode(0x60000000 + v.id, v.x, v.y + .8, v.z, 7, 220, null, 'rocket', now);
    }, (p, speed) => this.damage(null, p, Math.round((speed - 8) * 1.8), 'vehicle_collision', p.state.x, p.state.y + 1, p.state.z, now));
    // Signs, cones, barrels and saplings in the way give.
    for (const v of this.vehicles.states.values()) {
      if (v.exploded) continue;
      const lateral = v.motion?.lateral ?? 0;
      this.knock?.vehicle(v.x, v.z, -Math.sin(v.yaw) * v.speed + Math.cos(v.yaw) * lateral, -Math.cos(v.yaw) * v.speed - Math.sin(v.yaw) * lateral, VEHICLES[v.kind].halfZ, now);
    }
    this.vehicles.strike(now, (v, r) => this.zombies.near(v.x, v.z, r).filter((z) => !z.dead), (z) => z.state, 80,
      (z, v, amount, dx, dz, impulse) => this.hitZombie(v.driver ? this.players.get(v.driver) ?? null : null, z, amount, 'vehicle', z.state.x, z.state.y + 0.8, z.state.z, dx, dz, impulse, now));
    this.vehicles.strike(now, (v, r) => [...this.players.values()].filter((p) => !p.dead && !p.vehicleId && Math.hypot(p.state.x - v.x, p.state.z - v.z) < r), (p) => p.state, 80,
      (p, v, amount, dx, dz, impulse) => {
        // Being run over always hurts; the driver is only credited where they may attack this player.
        const driver = v.driver ? this.players.get(v.driver) : undefined;
        const by = driver && driver !== p && this.playerAttackAllowed(driver, p, now) ? driver.id : null;
        this.damage(by, p, amount, 'vehicle_collision', p.state.x, p.state.y + 1, p.state.z, now, 'xe tông', { kx: dx, kz: dz, force: +impulse.toFixed(2) });
        const until = p.dead ? 0 : throwBody(p.state, v, dx, dz, impulse, now);
        if (until) { p.knockedUntil = p.stunUntil = until; p.aiming = false; p.strike = null; p.dirty = true; }
        // A hard hit kills outright instead of leaving the victim downed.
        if (amount >= 140 && p.downed && !p.dead) this.killPlayer(p, by, now, 'xe tông');
      });
    // Battle royale bots are run over like players.
    if (this.bots) this.vehicles.strike(now, (v, r) => this.bots!.near(v.x, v.z, r).filter((b) => !b.state.flight), (b) => b.state, 80,
      (bot, v, amount, dx, dz, impulse) => {
        const driver = v.driver ? this.players.get(v.driver) : undefined;
        this.broadcastAt(bot.state.x, bot.state.z, { t: 'hit', attackerId: v.driver ?? 0, targetId: bot.id, zone: 'torso', damage: amount, x: bot.state.x, y: bot.state.y + 1, z: bot.state.z, kx: dx, kz: dz, force: +impulse.toFixed(2) });
        this.bots!.hit(bot, amount, driver?.username ?? 'xe', { x: v.x, z: v.z }, now, 'torso', driver?.id ?? null);
        const until = bot.dead ? 0 : throwBody(bot.state, v, dx, dz, impulse, now);
        if (until) { bot.knockedUntil = until; bot.target = null; }
      });
    // Vehicle movement is integrated once per tick, independent of input packet count.
    for (const p of this.players.values()) if (p.vehicleId) {
      this.grid.update(p); p.streamer.setCenter(p.chunkX, p.chunkZ);
      p.history.push(now, p.state.x, p.state.y, p.state.z, p.yaw, false, true);
    }
    // Everyone gets vehicles at 15 Hz; drivers every tick, to reconcile their own prediction.
    for (const p of this.players.values()) if (this.tick % 2 === 0 || p.vehicleId) this.vehicles.send(p, now);

    if (this.tick % PHYSICS_UPDATE_TICKS === 0) {
      const centers: Array<[number, number]> = [];
      for (const p of this.players.values()) centers.push([p.chunkX, p.chunkZ]);
      for (const c of this.joining.values()) centers.push(c);
      if (this.bots) centers.push(...this.bots.centers());
      this.physics.update(centers);
    }

    this.stepGrenades(now);
    this.stepShocks(now);
    this.activeScratch.length = 0;
    for (const p of this.players.values()) if (p.active) this.activeScratch.push(p);
    if (!this.arena) {
      this.zombies.step(this.activeScratch, now, this.timeOfDay());
      this.guards.step(this.zombies.zombies.values(), this.activeScratch, now);
    }
    // Announce the stalls to everyone once each NPC has been placed.
    if (!this.lifeBusy) for (const animal of this.animals.values()) {
      if (animal.dead && now - (animal.record.diedAt ?? 0) >= (animal.def.respawnMs ?? 10_000)) {
        if (this.wild.has(animal)) this.removeWild(animal);
        else animal.respawn();
        for (const p of this.players.values()) this.sendLife(p);
      }
    }
    if (!this.arena && this.tick % (TICK_RATE * 4) === 0) this.stepWildlife(now);
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
    if (!this.arena && (this.merchant.step(this.activeScratch, TICK_DT) || this.nurse.step(this.activeScratch, TICK_DT) || this.architect.step(this.activeScratch, TICK_DT))) this.broadcast(this.npcList());
    this.building?.step(TICK_DT, now);
    this.knock?.step(now);
    if (this.statsDirty && this.tick % 40 === 0) this.broadcastPlayerList();
    this.stepNpcCombat(now);
    this.stepNpcRetaliation(now);
    this.stepDowned(now);
    this.stepRounds(now);
    for (const charge of this.c4Charges.values()) {
      charge.step(this.collision, [...this.zombies.near(charge.s.x, charge.s.z, 4), ...this.animals.values(), ...this.guards.guards], TICK_DT);
    }
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
    // Snapshots first, then terrain into whatever room the connection has left.
    if (this.tick % SNAPSHOT_INTERVAL_TICKS === 0) this.sendSnapshots(now);
    for (const p of this.players.values()) p.streamer.update();

    if (Date.now() - this.lastPersist > PERSIST_INTERVAL_MS && !this.persisting) {
      this.lastPersist = Date.now();
      this.persisting = this.persistAll(false).finally(() => {
        this.persisting = null;
      });
    }
    const spent = performance.now() - t0;
    if (spent > TICK_MS) this.lastSlowTickAt = performance.now();
    this.deps.metrics.recordTick(spent, TICK_MS);
  }

  private applyInput(p: Player, input: InputMessage, now: number): void {
    if (p.vehicleId && p.vehicleSeat > 0) { this.passengerInput(p, input, now); return; }
    if (p.vehicleId) {
      this.vehicles.control(p, p.downed ? 0 : input.mz, p.downed ? 0 : input.mx, now);
      p.pitch = input.pitch; p.aiming = false; p.lastButtons = 0; p.lastProcessedSeq = input.s;
      return;
    }
    if (p.state.flight) {
      p.yaw = input.yaw; p.pitch = input.pitch; p.aiming = false;
      const jump = !!(input.b & Buttons.Jump) && !(p.lastButtons & Buttons.Jump);
      if (p.state.flight === 1 && jump) p.state.flight = 2;
      else stepAirborne(p.state, { mx: input.mx, mz: input.mz, yaw: input.yaw, jump, sprint: !!(input.b & Buttons.Sprint) }, this.collision, TICK_DT);
      p.lastButtons = input.b & (Buttons.Jump | Buttons.Sprint); p.lastProcessedSeq = input.s; return;
    }
    p.yaw = input.aimYaw ?? input.yaw;
    p.pitch = input.pitch;
    p.bandaging = (input.b & Buttons.Heal) !== 0 && !p.downed;
    p.eyeAim = input.aimYaw !== undefined;
    // What is in hand / on the back comes from the server's inventory, not the client's claim.
    const held = p.inv.equippedItem();
    const weapon = held ? (WEAPON_BY_ITEM[held.itemId] ?? 0) : 0;
    if (weapon !== p.weapon) { p.aiming = false; p.gunHeat = 0; p.lastGunShotAt = -Infinity; }
    p.weapon = weapon;
    const s = p.state;
    const px = s.x;
    const pz = s.z;
    let buttons = input.b;
    // Infection zombies only run, jump and swing.
    const zombie = !!this.infection?.isZombie(p.id);
    if (zombie) buttons &= ~(Buttons.Roll | Buttons.Prone | Buttons.Crouch | Buttons.LeanLeft | Buttons.LeanRight | Buttons.Aim | Buttons.ThrowC4 | Buttons.Heal);
    if (s.swimming) buttons &= ~(Buttons.Attack | Buttons.ThrowC4);
    if (tutorialProtected(p, this.serverTime)) buttons &= ~(Buttons.Attack | Buttons.ThrowC4);
    // Downed: can't do anything but lie there (and call for help).
    if (p.downed) { input = { ...input, mx: 0, mz: 0 }; buttons = 0; }
    const canAim = weaponSpec(p.weapon)?.kind === 'gun' && s.grounded && !s.swimming && s.rollTicks === 0 && !p.reloadAt && !p.downed && !p.dead;
    const aiming = canAim && (buttons & Buttons.Aim) !== 0;
    if (aiming && !p.aiming) p.aimStartedAt = now;
    p.aiming = aiming;
    if (!aiming) buttons &= ~Buttons.Aim;
    if (aiming || p.reloadAt || gunBlocksSprint(p.weapon, (buttons & Buttons.Attack) !== 0, now, p.fireReadyAt)) buttons &= ~Buttons.Sprint;
    if ((buttons & Buttons.Prone) || s.prone) buttons &= ~(Buttons.Sprint | Buttons.Roll | Buttons.Crouch);
    if ((buttons & Buttons.Crouch) || s.crouched) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    // No leaning while swimming, climbing or prone.
    if (s.swimming || s.climbing || s.prone || p.vehicleId) buttons &= ~(Buttons.LeanLeft | Buttons.LeanRight);
    // Exhausted (under 10% stamina): no sprinting, no rolling.
    if (p.life.stamina < this.life.config.stamina.maximum * 0.1) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    // Thrown by a vehicle: limp, nothing works until the body comes to rest.
    if (now < p.knockedUntil) { input = { ...input, mx: 0, mz: 0 }; buttons = 0; }
    // Staggered by a hit: no steering until it lands.
    if (now < p.stunUntil) { input = { ...input, mx: 0, mz: 0 }; buttons &= ~(Buttons.Sprint | Buttons.Roll | Buttons.Jump); }
    // Swinging a melee weapon: no sprinting until the swing is over.
    // A melee swing roots the feet until it ends (a lunge still carries the body).
    if (now < p.attackingUntil && weaponSpec(p.weapon)?.kind === 'melee') { input = { ...input, mx: 0, mz: 0 }; buttons &= ~Buttons.Sprint; }
    // The finisher's lunge only with the combo's last swing, starting this tick.
    // …or the long-hafted slash's step in (the quắm's second swing).
    if (buttons & Buttons.Lunge) {
      const attacking = (buttons & Buttons.Attack) !== 0 && s.grounded && s.rollTicks === 0 && !s.prone && !s.swimming;
      const spec = weaponSpec(p.weapon);
      const long = (buttons & Buttons.LungeLong) !== 0;
      const ok = !attacking ? false : long
        ? spec?.kind === 'melee' && now >= p.attackReadyAt - FIRE_TOLERANCE_MS && meleeSwing(p.weapon, spec, p.meleeSwings)?.clip === LONG_LUNGE_CLIP
        : BLADE_COMBO_WEAPONS.has(p.weapon) && now >= p.attackReadyAt - BLADE_COMBO_TOLERANCE_MS && !!BLADE_COMBO[nextBladeStep(p.bladeStep, p.bladeReadyAt, now)]!.lunge;
      if (!ok) buttons &= ~(Buttons.Lunge | Buttons.LungeLong);
    } else buttons &= ~Buttons.LungeLong;
    if ((buttons & Buttons.Sprint) && (input.mx || input.mz) && !this.life.spend(p.life, this.life.config.stamina.sprintPerSecond * TICK_DT * this.effort(p))) buttons &= ~Buttons.Sprint;
    if ((buttons & Buttons.Roll) && p.state.rollTicks === 0 && p.state.rollCooldown === 0 && p.state.grounded && !this.life.spend(p.life, this.life.config.stamina.roll * this.effort(p))) buttons &= ~Buttons.Roll;
    input = { ...input, b: buttons };
    p.lastButtons = buttons;
    const wasRolling = p.state.rollTicks > 0;
    const falling = !s.grounded && !s.swimming && !s.climbing ? -s.vy : 0;
    const info = this.controller.step(
      s,
      { mx: input.mx, mz: input.mz, yaw: input.yaw, jump: (input.b & Buttons.Jump) !== 0, sprint: (input.b & Buttons.Sprint) !== 0, roll: (input.b & Buttons.Roll) !== 0, lunge: (input.b & Buttons.Lunge) !== 0, lungeKind: input.b & Buttons.LungeLong ? 1 : 0, prone: (input.b & Buttons.Prone) !== 0, crouch: (input.b & Buttons.Crouch) !== 0, speedMul: p.speedMul * (p.aiming ? .65 : 1) * (now < p.slowUntil ? p.slowFactor : 1), jumpMul: zombie ? this.infectionRules.zombieJump : 1 },
      TICK_DT,
      this.stepInfo,
    );
    if (!wasRolling && p.state.rollTicks > 0) p.state.rollCooldown = Math.round(this.life.config.stamina.rollCooldown / TICK_DT);
    // Battle royale lobby: nobody leaves the ring before the drop.
    if (this.battle?.inLobby && this.battle.lobby) keepInCircle(s, this.battle.lobby);
    // Fall damage: a hard landing (over ~11 m/s, about a 6 m drop) hurts, a long fall kills.
    if (falling > 11 && s.grounded && !s.swimming) this.damage(null, p, Math.round((falling - 11) ** 2 * 1.2), 'fall', s.x, s.y, s.z, now, 'rơi từ trên cao');
    p.frozenTicks = info.frozen ? p.frozenTicks + 1 : 0;
    const dx = s.x - px;
    const dz = s.z - pz;
    if (dx * dx + dz * dz > MAX_STEP_DISTANCE * MAX_STEP_DISTANCE) {
      this.flag(p, 'movement_anomaly', { d: Math.sqrt(dx * dx + dz * dz) });
    }
    if (dx !== 0 || dz !== 0) p.dirty = true;
    if (s.stuckTicks > STUCK_TICKS_LIMIT) this.unstick(p);
    // Infection map models: fell below every floor of the map (under its pits): back on top.
    if (this.infection && s.y < INFECTION_GROUND - 4.4 && !p.dead) this.teleport(p, this.infectionSpot(this.infection.isZombie(p.id)));
    // Wedged inside a model's wall (spawned or pushed there): move to the nearest open spot.
    if (this.tick % 30 === p.id % 30 && !p.vehicleId && !s.flight && s.grounded && Math.hypot(s.vx, s.vz) < .2 && this.spawns.inWallGap(s.x, s.y, s.z)) this.unstick(p);
    // Check after movement too: an attack pressed on the tick entering water is blocked.
    if (s.swimming) {
      p.lastButtons &= ~Buttons.Attack;
      p.strike = null;
      p.attackingUntil = 0;
    }
    if (!s.swimming && p.weapon === WeaponId.C4 && s.rollTicks === 0) {
      if (input.b & Buttons.ThrowC4) this.tryThrowC4(p, now);
      else if (input.b & Buttons.Attack) this.tryDetonateC4(p, now);
    } else if (!s.swimming && (input.b & Buttons.Attack) !== 0 && p.weapon !== WeaponId.C4) {
      const spec = weaponSpec(p.weapon);
      if (spec?.kind === 'gun') {
        // No shooting while airborne (jumping/falling).
        if (p.state.grounded) {
          if (spec.fire === 'projectile') this.tryLaunch(p, spec, now, input.bore);
          else if (spec.fire === 'flame') this.tryFlame(p, spec, now, input.bore);
          else this.tryShoot(p, now, input.rt, input.bore);
        }
      }
      else if (spec?.kind === 'throw') this.tryThrow(p, now);
      else this.tryAttack(p, now, input.rt, spec?.kind === 'melee' ? spec : undefined);
    }
    p.lastProcessedSeq = input.s;
  }

  /**
   * A passenger: the seat carries them, they only look around and use their gun (aim and fire;
   * shots leave through the vehicle's own body).
   */
  private passengerInput(p: Player, input: InputMessage, now: number): void {
    p.yaw = input.aimYaw ?? input.yaw;
    p.pitch = input.pitch;
    p.eyeAim = input.aimYaw !== undefined;
    p.bandaging = false;
    const held = p.inv.equippedItem();
    const weapon = held ? (WEAPON_BY_ITEM[held.itemId] ?? 0) : 0;
    if (weapon !== p.weapon) { p.aiming = false; p.gunHeat = 0; p.lastGunShotAt = -Infinity; }
    p.weapon = weapon;
    const spec = weaponSpec(p.weapon);
    let buttons = p.downed || tutorialProtected(p, this.serverTime) ? 0 : input.b & (Buttons.Attack | Buttons.Aim);
    const aiming = spec?.kind === 'gun' && !p.reloadAt && (buttons & Buttons.Aim) !== 0;
    if (aiming && !p.aiming) p.aimStartedAt = now;
    p.aiming = aiming;
    if (!aiming) buttons &= ~Buttons.Aim;
    p.lastButtons = buttons;
    const v = this.vehicles.driving(p);
    if (v && spec?.kind === 'gun' && (buttons & Buttons.Attack)) {
      this.vehicles.withoutColliders(v, () => {
        if (spec.fire === 'projectile') this.tryLaunch(p, spec, now, input.bore);
        else if (spec.fire === 'flame') this.tryFlame(p, spec, now, input.bore);
        else this.tryShoot(p, now, input.rt, input.bore);
      });
    }
    p.lastProcessedSeq = input.s;
  }

  /** Neutral step when a client's inputs stall (keeps gravity/water physics authoritative). */
  private coast(p: Player): void {
    if (p.vehicleId) return;
    if (p.state.flight) { stepAirborne(p.state, { mx: 0, mz: 0, yaw: p.yaw, jump: false, sprint: false }, this.collision, TICK_DT); return; }
    this.controller.step(p.state, { mx: 0, mz: 0, yaw: p.yaw, jump: false, sprint: false, prone: p.state.prone, speedMul: p.speedMul }, TICK_DT, this.stepInfo);
  }

  /** Shot origin of a leaning shooter: out to the side, but never through the wall leant against. */
  private leanOrigin(p: Player, oy: number): [number, number] {
    const s = p.state, lean = leanOf(p.lastButtons);
    if (!lean) return [s.x, s.z];
    const [dx, dz] = leanOffset(p.yaw, lean), d = Math.hypot(dx, dz);
    const t = this.collision.raycast(s.x, oy, s.z, dx / d, 0, dz / d, d + .15, Mask.LineOfSight, this.leanHit) ? Math.max(0, this.leanHit.t - .15) : d;
    return [s.x + dx / d * t, s.z + dz / d * t];
  }
  private readonly leanHit = makeRayHit();

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
    s.prone = false;
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
    if (now < p.attackReadyAt - (BLADE_COMBO_WEAPONS.has(p.weapon) && blade ? BLADE_COMBO_TOLERANCE_MS : FIRE_TOLERANCE_MS)) return;
    if (!this.life.spend(p.life, this.attackStaminaCost(p))) return;
    if (renderTime !== undefined && (renderTime > now + 1000 || renderTime < now - 2000)) {
      this.flag(p, 'rewind_out_of_window', { delta: Math.round(now - renderTime) });
    }
    if (blade && BLADE_COMBO_WEAPONS.has(p.weapon)) {
      // One-handed blade: the next step of the combo, timed and weighted by that step.
      const step = nextBladeStep(p.bladeStep, p.bladeReadyAt, now), timing = bladeStepTiming(blade, step), c = BLADE_COMBO[step]!;
      p.bladeStep = step;
      p.attackReadyAt = p.bladeReadyAt = now + timing.cooldownMs;
      p.attackingUntil = now + timing.durationMs;
      const cut: MeleeSpec = { ...blade, damage: blade.damage * c.damage, halfAngle: c.halfAngle, range: blade.range + c.rangeBonus,
        decapitationChance: (blade.decapitationChance ?? 0) * (c.lunge ? 2 : 1), cleaveMultiplier: c.lunge ? .9 : blade.cleaveMultiplier };
      p.strike = { at: now + timing.hitMs, blade: cut, rewind: renderTime === undefined ? undefined : now - renderTime };
      return;
    }
    // Long-hafted and heavy weapons: the blow lands at the recorded swing's fastest point.
    const swing = blade ? meleeSwing(p.weapon, blade, p.meleeSwings++) : null;
    if (blade && swing) {
      p.attackReadyAt = now + Math.max(blade.cooldownMs, swing.durationMs * .85);
      p.attackingUntil = now + swing.durationMs;
      p.strike = { at: now + swing.hitMs, blade, rewind: renderTime === undefined ? undefined : now - renderTime };
      return;
    }
    p.attackReadyAt = now + (blade?.cooldownMs ?? MELEE.cooldownMs);
    p.attackingUntil = now + (blade?.swingMs ?? MELEE.swingMs);
    // Like a zombie's bite, the blow lands after its wind-up, judged on where everyone is then.
    p.strike = { at: now + (blade ? blade.hitDelayMs ?? BLADE_HIT_DELAY_MS : FIST_HIT_DELAY_MS), blade, rewind: renderTime === undefined ? undefined : now - renderTime };
  }

  /** Resolves pending melee blows whose wind-up has elapsed (only if the attacker still lives). */
  private stepStrikes(now: number): void {
    for (const p of this.activeScratch) {
      const st = p.strike;
      if (!st || now < st.at) continue;
      p.strike = null;
      if (p.dead || p.questBusy || p.state.swimming) continue;
      this.resolveStrike(p, now, st.rewind === undefined ? undefined : now - st.rewind, st.blade);
    }
  }

  private resolveStrike(p: Player, now: number, renderTime: number | undefined, blade?: MeleeSpec): void {
    const range = blade?.range ?? MELEE.range;
    const candidates: Combatant[] = [...this.grid.query(p.chunkX, p.chunkZ, 1, this.scratch).filter((t) => !this.allied(p, t)), ...this.zombies.near(p.state.x, p.state.z, range + 2), ...this.animals.values(), ...(this.bots?.near(p.state.x, p.state.z, range + 2) ?? [])];
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
      ? resolveBladeSweep(p, candidates, this.collision, now, renderTime, { range, damage: blade.damage, halfAngle: blade.halfAngle ?? 1.05 })
      : resolveMelee(p, candidates, this.collision, now, renderTime);
    if (!res) {
      // Nobody in reach: the blow lands on a tree, a rock or a wall.
      this.building?.strike(p, p.inv.equippedItem()?.itemId, blade?.damage ?? MELEE.baseDamage, now);
      return;
    }
    const apply = (target: Combatant, damage: number, zone: string, x: number, y: number, z: number, force: number) => {
      const sever = target instanceof Zombie && target.variant !== ZombieVariant.Brute && !target.dead && rollsDecapitation(blade);
      this.hitTarget(p, target, sever ? target.health : damage, sever ? 'decapitation' : zone, x, y, z, -Math.sin(p.yaw), -Math.cos(p.yaw), force, now);
    };
    apply(res.target, res.damage, blade && res.zone === 'torso' ? 'slash' : res.zone, res.x, res.y, res.z, blade ? 4 : 2.5);
    if (blade?.stunMs && res.target instanceof Zombie) this.zombies.stun(res.target, blade.stunMs, now);
    if (blade) {
      // Secondary cuts only affect zombies; each keeps its own reach and wall check.
      const seen = new Set<Combatant>([res.target]);
      for (const target of candidates) {
        if (!(target instanceof Zombie) || seen.has(target)) continue;
        seen.add(target);
        const splash = resolveBladeSweep(p, [target], this.collision, now, renderTime, { range, damage: blade.damage * (blade.cleaveMultiplier ?? .5), halfAngle: blade.halfAngle ?? 1.05 });
        if (splash) {
          apply(target, splash.damage, 'slash', splash.x, splash.y, splash.z, 2);
          if (blade.stunMs) this.zombies.stun(target, blade.stunMs, now);
        }
      }
    }
  }

  private sendPvp(p: Player, now: number): void {
    const remainingMs = Math.max(0, p.pvpUntil - now);
    p.pvpLastSecond = Math.ceil(remainingMs / 1000);
    p.session.sendJson({ t: 'pvp', enabled: p.pvpEnabled, remainingMs });
  }

  private playerAttackAllowed(attacker: Player, target: Player, now: number): boolean {
    if (attacker === target || attacker.dead || attacker.downed) return false;
    if (this.infection) return this.infection.canHarm(attacker.id, target.id);
    if (this.battle) return this.battle.canFight(attacker.id) && this.battle.canFight(target.id);
    // A real player hit reveals the control even when damage is disabled.
    if (attacker.pvpUntil <= now && attacker.pvpEnabled) {
      attacker.pvpEnabled = false;
      this.broadcastPlayerList();
    }
    attacker.pvpUntil = now + 60_000;
    this.sendPvp(attacker, now);
    return (attacker.pvpEnabled || (target.pvpEnabled && target.pvpUntil > now)) && !this.allied(attacker, target);
  }

  /** Routes a hit to a player or a zombie. */
  private hitTarget(attacker: Player, target: Combatant, amount: number, zone: string, x: number, y: number, z: number, dirX: number, dirZ: number, impulse: number, now: number, knockbackMultiplier = 1, weapon = attacker.weapon): void {
    if (target instanceof Zombie) this.hitZombie(attacker, target, amount, zone, x, y, z, dirX, dirZ, impulse, now);
    else if (target instanceof Livestock) this.hitAnimal(attacker, target, amount, now, x, y, z);
    else if (target instanceof BattleBot) {
      if (this.infection) { this.infectionBotDamage(target, amount, attacker.id, attacker.state, zone, now); return; }
      if (!this.battle?.canFight(attacker.id)) return;
      this.broadcastAt(x, z, { t: 'hit', attackerId: attacker.id, targetId: target.id, zone, damage: amount, x, y, z });
      this.bots?.hit(target, amount, attacker.username, { x: attacker.state.x, z: attacker.state.z }, now, zone, attacker.id);
    }
    else {
      const t = target as Player;
      if (!this.playerAttackAllowed(attacker, t, now) || (!this.arena && tutorialProtected(t, this.serverTime))) return;
      this.damage(attacker.id, t, amount, zone, x, y, z, now, weapon);
      // Bullets do not shove the target: the server-only push and stun fought the victim's own
      // prediction and made them rubber-band while under fire. Melee and blasts still knock back.
      if (amount > 0 && !this.infection && weaponSpec(weapon)?.kind !== 'gun' && !this.spawns.inSafeZone(t.state.x, t.state.z)) this.knockback(t, dirX, dirZ, now, knockbackMultiplier);
      // Infection: bullets stagger the infected, a shove back and a moment of slowness, sent to
      // the victim too so its own prediction moves the same way (no rubber-banding).
      if (amount > 0 && this.infection?.isZombie(t.id) && weaponSpec(weapon)?.kind === 'gun' && !t.dead) this.stagger(t, dirX, dirZ, amount, knockbackMultiplier, now);
    }
  }

  private stagger(t: Player, dirX: number, dirZ: number, amount: number, multiplier: number, now: number): void {
    const l = Math.hypot(dirX, dirZ) || 1, push = Math.min(7, 2.2 + amount * .09) * multiplier;
    const vx = dirX / l * push, vz = dirZ / l * push, ms = Math.min(1400, 450 + amount * 18), factor = .45;
    t.state.vx += vx; t.state.vz += vz;
    t.slowUntil = Math.max(t.slowUntil, now + ms); t.slowFactor = factor;
    t.dirty = true;
    t.session.sendJson({ t: 'stagger', vx: +vx.toFixed(2), vz: +vz.toFixed(2), factor, ms });
  }

  /** Shot: thrown off the feet away from the shooter (brief stagger, no steering mid-air). */
  private knockback(t: Player, dirX: number, dirZ: number, now: number, multiplier = 1): void {
    if (t.dead) return;
    const l = Math.hypot(dirX, dirZ) || 1;
    t.state.vx = (dirX / l) * 6 * multiplier;
    t.state.vz = (dirZ / l) * 6 * multiplier;
    t.state.vy = Math.max(t.state.vy, 3.5 * Math.sqrt(multiplier));
    t.state.grounded = false;
    t.stunUntil = now + 550;
    t.dirty = true;
  }

  private hitZombie(attacker: Player | null, zb: Zombie, amount: number, zone: string, x: number, y: number, z: number, dirX: number, dirZ: number, impulse: number, now: number, sourceId = attacker?.id ?? 0): void {
    if (zb.variant === ZombieVariant.Brute) {
      impulse = 0;
      if (zone === 'decapitation') zone = 'slash';
    }
    const res = this.zombies.hit(zb, zone, amount, dirX, dirZ, impulse, now, attacker);
    const len = Math.hypot(dirX, dirZ) || 1;
    const msgHit = {
      t: 'hit' as const,
      attackerId: sourceId,
      targetId: zb.id,
      // A bucket over the head rings instead of bleeding (and flies off when it breaks).
      zone: res.shield === 'bucket' ? 'bucket' : res.shield === 'bucketBroke' ? 'bucket_break' : zone,
      damage: res.shield === 'bucket' || res.shield === 'bucketBroke' ? 0 : Math.round(amount),
      x,
      y,
      z,
      kx: +(dirX / len).toFixed(3),
      kz: +(dirZ / len).toFixed(3),
      force: +impulse.toFixed(2),
    };
    this.broadcastAt(zb.state.x, zb.state.z, msgHit);
    if (res.killed) {
      const firstKill = attacker ? recordZombieKill(attacker) : false;
      if (attacker) {
        this.queueQuestEvent(attacker, { type: 'kill', target: 'zombie' });
        void this.deps.teams?.progress(attacker.accountId, { x: zb.state.x, z: zb.state.z }).catch((err: unknown) => this.log.error({ err }, 'team kill progress failed'));
      }
      this.broadcastAt(zb.state.x, zb.state.z, { t: 'death', playerId: zb.id, killerId: sourceId || null });
      // Some zombies drop a ZCoin where they fell; whoever picks it up gets it.
      if (firstKill || Math.random() < ZOMBIE_COIN_DROP_CHANCE) this.dropCoin(zb.state.x, zb.state.y, zb.state.z, now);
      if (firstKill && attacker) attacker.session.sendJson({ t: 'tutorialState', ...tutorialProgress(attacker) });
    }
  }

  private broadcastAt(x: number, z: number, msg: ServerJsonMessage): void {
    const near = this.grid.query(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), ENTITY_INTEREST_RADIUS_CHUNKS, []);
    if (!near.length) return;
    const text = JSON.stringify(msg);
    for (const p of near) p.session.sendText(text);
  }

  private damage(attackerId: number | null, t: Player, amount: number, zone: string, x: number, y: number, z: number, now: number, weapon?: number | string, knock?: { kx: number; kz: number; force: number }): void {
    const attacker = attackerId !== null ? this.players.get(attackerId) : undefined;
    if (attackerId !== null && !isZombieId(attackerId) && attackerId < NPC_ID_BASE) {
      if (!attacker || !this.playerAttackAllowed(attacker, t, now)) return;
    }
    if (t.dead || amount <= 0 || (!this.arena && tutorialProtected(t, this.serverTime))) return;
    if (this.battle && !this.battle.canFight(t.id)) return;
    if (this.infection) { this.infectionDamage(attackerId, t, amount, zone, x, y, z, now, weapon); return; }
    if (t.questBusy) { t.afterQuest.push(() => this.damage(attackerId, t, amount, zone, x, y, z, now, weapon, knock)); return; }
    if (t.downed) {
      // Hitting someone who is down drains what is left of their bleed-out.
      t.bleed -= amount;
      this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: amount, x, y, z });
      if (t.bleed <= 0 || zone === 'suicide') this.killPlayer(t, attackerId ?? t.downedBy, now, weapon ?? (zone === 'red_zone' ? 'vòng bo đỏ' : undefined));
      return;
    }
    // Safe zone: no player-caused damage (guns, melee, grenades) to players inside the camp.
    // (Camp NPCs firing back at whoever shot them are the exception.)
    if (attackerId !== null && !isZombieId(attackerId) && attackerId < NPC_ID_BASE && this.spawns.inSafeZone(t.state.x, t.state.z)) return;
    // Worn armour soaks up part of every hit and wears down by what it absorbed.
    const prot = zone === 'red_zone' ? 0 : armorProtection(t.armor);
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
    this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: amount, x, y, z, ...knock });
    if (t.health <= 0) {
      const cause = weapon ?? (zone === 'red_zone' ? 'vòng bo đỏ' : undefined);
      // Battle royale: a squad member with a teammate still standing goes down and waits for a revive.
      if (zone === 'suicide' || (this.battle && !this.standingAlly(t))) this.killPlayer(t, attackerId, now, cause);
      else { this.knockDown(t, now); t.downedBy = attackerId; }
      this.squadWipe(t, now);
    }
  }

  /** A teammate of `t` (battle royale squad) who is alive and on their feet. */
  private standingAlly(t: Player): Player | undefined {
    if (!this.battle) return undefined;
    for (const q of this.players.values()) if (q !== t && !q.dead && !q.downed && this.battle.allies(t.id, q.id)) return q;
    return undefined;
  }
  /** Battle royale: once nobody in a squad stands, its downed members cannot be saved. */
  private squadWipe(t: Player, now: number): void {
    if (!this.battle || this.standingAlly(t) || (!t.dead && !t.downed)) return;
    for (const q of [...this.players.values()]) if (q.downed && !q.dead && this.battle.allies(t.id, q.id)) this.killPlayer(q, q.downedBy, now);
  }

  /** Out of health: down on the ground, bleeding out (100 over 60 s) until revived or dead. */
  private knockDown(t: Player, now: number): void {
    this.vehicles.release(t);
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
  private killPlayer(t: Player, attackerId: number | null, now: number, cause?: number | string): void {
    if (t.dead) return;
    this.credit(attackerId, t.id);
    t.killedBy = attackerId !== t.id ? attackerId : null;
    this.vehicles.release(t);
    t.downed = false;
    t.bleed = 0;
    t.reviving = null;
    t.health = 0;
    t.dead = true;
    t.state.flight = 0;
    this.cancelLifeAction(t);
    t.deadAt = now;
    t.killerId = attackerId;
    if (this.infection) {
      // A zombie went down: it rises again at a spawn point a few seconds later.
      this.infection.respawnAt.set(t.id, now + this.infectionRules.zombieRespawnMs);
      const killer = attackerId === null ? undefined : this.players.get(attackerId)?.username ?? this.bots?.bots.find((b) => b.id === attackerId)?.name;
      this.broadcast({ t: 'chat', from: 'LÂY NHIỄM', fromId: 0, system: true, text: killer ? `${killer} đã hạ zombie ${t.username}.` : `Zombie ${t.username} đã gục.` });
      this.broadcastInfection();
    }
    if (this.battle) {
      this.battle.eliminate(t.id);
      this.squadWipe(t, now);
      const killer = attackerId === null ? undefined : this.players.get(attackerId);
      const weapon = cause ?? killer?.weapon ?? 0;
      const itemId = typeof weapon === 'number' ? Object.keys(WEAPON_BY_ITEM).find(id => WEAPON_BY_ITEM[id] === weapon) : undefined;
      const label = typeof weapon === 'string' ? weapon : itemId ? ITEMS[itemId]?.name ?? itemId : 'tay không';
      this.broadcast({ t: 'chat', from: 'BATTLE ROYALE', fromId: 0, system: true, text: killer ? `${killer.username} đã hạ ${t.username} bằng ${label}.` : `${t.username} đã bị loại bởi ${label}.` });
      this.chests.close(t);
      const items = t.inv.items.filter(item => !isStash(item.container)).map(item => ({ ...item, container: 'backpack' as const, x: 0, y: 0 }));
      const id = `9999:${t.id}:${Math.round(now)}:0`;
      const crate = { id, x: t.state.x, y: t.state.y, z: t.state.z };
      this.battleChests.set(id, { items, searched: true, revision: 0, capacity: Math.max(24, items.length) });
      this.deathCrates.set(id, crate);
      for (const item of items) t.inv.remove(item.uid);
      this.broadcast({ t: 'lootCrates', crates: [...this.deathCrates.values()] });
      this.syncLoadout(t); this.sendInv(t);
    }
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
    if (this.deps.progression) {
      const commit = () => {
        t.questBusy = true;
        void this.deps.playerStates.saveMany([{ accountId: t.accountId, x: t.state.x, y: t.state.y, z: t.state.z, yaw: t.yaw, health: 0, coins: t.coins, inventory: t.inv.toJSON(), journal: structuredClone(t.journal), life: structuredClone(t.life), suspendedZombies: t.suspendedZombies, careerEvent: { id: `death:${randomUUID()}`, death: true } }])
          .then(() => this.refreshRank(t)).catch((err: unknown) => this.log.error({ err }, 'death career save failed')).finally(() => this.finishQuestMutation(t));
      };
      if (t.questBusy) t.afterQuest.push(commit); else commit();
    }
  }

  /** Bleeding out, and revives in progress. */
  private stepDowned(now: number): void {
    for (const p of this.players.values()) {
      if (p.downed && !tutorialProtected(p, now)) {
        p.bleed -= (100 / 60) * TICK_DT;
        if (p.bleed <= 0) this.killPlayer(p, p.downedBy, now);
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
      t.downedBy = null;
      t.bleed = 0;
      t.health = 30;
      t.dirty = true;
      this.reply(t, `${p.username} đã cứu bạn dậy!`);
    }
  }

  private shotBore(p: Player, bore?: InputMessage['bore']) {
    const y = p.state.y + muzzleHeight(p.state.prone, !!p.state.crouched);
    const [x, z] = this.leanOrigin(p, y);
    const [dx, dy, dz] = aimDirection(p.yaw, p.pitch);
    return animatedBore(p.state, { x, y, z, dx, dy, dz }, bore, this.collision);
  }

  /** Spawn ammunition now; damage is resolved only when its swept flight reaches a body. */
  private tryShoot(p: Player, now: number, _renderTime: number | undefined, bore?: InputMessage['bore']): void {
    const spec = WEAPON_SPECS[p.weapon as Exclude<WeaponId, 0>];
    if (spec?.kind !== 'gun' || now < p.fireReadyAt - FIRE_TOLERANCE_MS || this.rounds.length + spec.pellets > 4096) return;
    if (p.life.stamina < this.attackStaminaCost(p) || !this.useRound(p)) return;
    this.life.spend(p.life, this.attackStaminaCost(p));
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const s = p.state;
    const { x: ox, y: oy, z: oz, dx: ax, dy: ay, dz: az } = this.shotBore(p, bore);
    const attachments = p.inv.equippedItem()?.attachments;
    p.gunHeat = Math.max(0, p.gunHeat - (now - p.lastGunShotAt) / 700);
    const spread = gunSpread(spec, p.aiming ? (now - p.aimStartedAt) / 180 : 0, Math.hypot(s.vx, s.vz), s.prone, p.gunHeat) * attachmentModifier(attachments, 'spread');
    p.gunHeat = Math.min(1.5, p.gunHeat + .22);
    p.lastGunShotAt = now;
    const proj = bulletSpec(p.weapon, spec);
    // Mouse-look aim already runs from the muzzle to the crosshair point: only the drop to the zero is added.
    // With an animated bore, elevation is already visible on the weapon itself.
    const [bx, by, bz] = p.eyeAim && !bore ? droppedDirection(ax, ay, az, zeroDistance(spec, !!opticOf(attachments)), proj.speed, proj.gravity) : [ax, ay, az];
    this.broadcastNear(p, { t: 'shot', shooterId: p.id, w: p.weapon, ox, oy, oz, ends: [], ...(attachmentModifier(attachments, 'flash') === 0 ? { sup: 1 as const } : {}) });
    for (let i = 0; i < spec.pellets; i++) {
      const [dx, dy, dz] = spreadDirection(bx, by, bz, spread, Math.random);
      const id = this.nextGrenadeId++;
      const vx = dx * proj.speed, vy = dy * proj.speed, vz = dz * proj.speed;
      this.rounds.push({ id, owner: p, w: p.weapon, spec: proj, damage: spec.damage, knockback: spec.knockback ?? 1, traveled: 0, x: ox, y: oy, z: oz, vx, vy, vz, dieAt: now + proj.maxFlightSec * 1000 });
      this.broadcastNear(p, { t: 'proj', id, ownerId: p.id, w: p.weapon, kind: 'bullet', x: ox, y: oy, z: oz, vx, vy, vz, gravity: proj.gravity, drag: proj.drag, maxFlightSec: proj.maxFlightSec });
    }
    this.zombies.alert(ox, oz, 45, now);
  }

  private tryThrow(p: Player, now: number): void {
    // Any hand-thrown grenade: frag, stun, smoke (and Studio-made ones); not the remote C4.
    const weapon = WEAPON_BY_ITEM[p.inv.equippedItem()?.itemId ?? ''] ?? 0;
    const spec = weaponSpec(weapon);
    if (spec?.kind !== 'throw' || spec.remote || now < p.throwReadyAt || p.life.stamina < this.attackStaminaCost(p)) return;
    p.inv.consumeEquipped();
    this.syncLoadout(p);
    this.sendInv(p);
    this.life.spend(p.life, this.attackStaminaCost(p));
    p.throwReadyAt = now + spec.cooldownMs;
    p.attackingUntil = now + 400;
    const s = p.state;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const ox = s.x + fx * 0.4;
    const oy = s.y + (s.prone ? muzzleHeight(true) : 1.6);
    const oz = s.z + fz * 0.4;
    // Thrown along the aim (yaw and pitch) like a shot, only slower and dropping sooner.
    const [dx, dy, dz] = aimDirection(p.yaw, p.pitch), speed = aimedThrowSpeed(spec);
    const g = {
      id: this.nextGrenadeId++,
      ownerId: p.id,
      owner: p,
      s: { x: ox, y: oy, z: oz, vx: dx * speed, vy: dy * speed, vz: dz * speed, resting: false },
      explodeAt: now + spec.fuseMs,
      spec,
    };
    this.grenades.push(g);
    this.broadcastNear(p, { t: 'grenade', id: g.id, ownerId: p.id, ...pick(g.s), fuseMs: spec.fuseMs, ...(weapon !== WeaponId.Grenade ? { w: weapon } : {}) });
  }

  private tryThrowC4(p: Player, now: number): void {
    const item = p.inv.equippedItem();
    const spec = WEAPON_SPECS[WeaponId.C4];
    if (item?.itemId !== 'c4' || spec.kind !== 'throw' || now < p.throwReadyAt || p.life.stamina < this.attackStaminaCost(p)) return;
    if ([...this.c4Charges.values()].filter(c => c.accountId === p.accountId).length >= 32) return;
    const s = p.state;
    // Start at the body, so even a wall touching the player is swept before the bomb passes it.
    // Thrown along the aim, like a grenade.
    const oy = s.y + (s.prone ? muzzleHeight(true) : 1.6);
    const [dx, dy, dz] = aimDirection(p.yaw, p.pitch), speed = aimedThrowSpeed(spec);
    const id = this.nextGrenadeId++;
    this.c4Charges.set(id, new C4Charge(id, p.accountId, item.uid, { x: s.x, y: oy, z: s.z, vx: dx * speed, vy: dy * speed, vz: dz * speed, resting: false }));
    item.itemId = 'c4_detonator';
    item.chargeId = id;
    p.throwReadyAt = now + spec.cooldownMs;
    p.attackingUntil = now + 400;
    this.life.spend(p.life, this.attackStaminaCost(p));
    this.syncLoadout(p); this.sendInv(p);
  }

  private tryDetonateC4(p: Player, now: number): void {
    const item = p.inv.equippedItem();
    if (item?.itemId !== 'c4_detonator') return;
    const charge = item.chargeId ? this.c4Charges.get(item.chargeId) : undefined;
    const spec = WEAPON_SPECS[WeaponId.C4];
    if (!charge || charge.accountId !== p.accountId || charge.itemUid !== item.uid || spec.kind !== 'throw') return;
    this.c4Charges.delete(charge.id);
    p.inv.consumeEquipped();
    this.syncLoadout(p); this.sendInv(p);
    this.explode(charge.id, charge.s.x, charge.s.y, charge.s.z, spec.radius, spec.damage, p, 'grenade', now);
  }

  private stepShocks(now: number): void {
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const w = this.shocks[i]!, front = shockwaveFront(w.radius, (now - w.start) / 1000), reach = shockwaveFront(w.radius, Infinity);
      const liveOwner = w.owner && this.players.get(w.owner.id) === w.owner ? w.owner : null;
      // Inside the blast radius the fireball already struck: the wave carries the harm beyond it.
      const struck = (body: unknown, d: number) => d <= front && d >= w.radius && !w.hit.has(body) && (w.hit.add(body), true);
      const cx = Math.floor(w.x / CHUNK_SIZE), cz = Math.floor(w.z / CHUNK_SIZE);
      for (const zb of this.zombies.near(w.x, w.z, front)) {
        if (zb.dead) continue;
        const tx = zb.state.x - w.x, tz = zb.state.z - w.z, d = Math.hypot(tx, zb.state.y + .6 - w.y, tz);
        if (!struck(zb, d)) continue;
        const amount = shockwaveDamage(w.radius, w.damage, d);
        zb.state.vy += 2.5 * (1 - d / reach);
        if (amount > 0) this.hitZombie(liveOwner, zb, amount, 'torso', zb.state.x, zb.state.y + .8, zb.state.z, tx, tz, 6 * (1 - d / reach), now);
      }
      for (const t of this.grid.query(cx, cz, Math.ceil(front / CHUNK_SIZE) + 1, this.scratch)) {
        if (!t.active || t.dead) continue;
        const tx = t.state.x - w.x, tz = t.state.z - w.z, d = Math.hypot(tx, t.state.y + .9 - w.y, tz);
        if (!struck(t, d)) continue;
        const amount = shockwaveDamage(w.radius, w.damage, d), h = Math.hypot(tx, tz) || 1;
        if (amount > 0) this.damage(w.owner?.id ?? null, t, amount, 'blast', t.state.x, t.state.y + .9, t.state.z, now, w.label, { kx: tx / h, kz: tz / h, force: 6 * (1 - d / reach) });
      }
      for (const bot of this.bots?.near(w.x, w.z, front) ?? []) {
        const d = Math.hypot(bot.state.x - w.x, bot.state.y + .9 - w.y, bot.state.z - w.z);
        if (!struck(bot, d)) continue;
        const amount = shockwaveDamage(w.radius, w.damage, d);
        if (amount <= 0) continue;
        if (this.infection) this.infectionBotDamage(bot, amount, w.owner?.id ?? null, { x: w.x, z: w.z }, 'blast', now);
        else this.bots!.hit(bot, amount, w.owner?.username ?? w.label, { x: w.x, z: w.z }, now, 'blast', w.owner?.id ?? null);
      }
      if (front >= reach) this.shocks.splice(i, 1);
    }
  }

  private stepGrenades(now: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!, spec = g.spec;
      stepProjectile(g.s, this.collision, GRENADE_GRAVITY, TICK_DT);
      if (now < g.explodeAt) continue;
      this.grenades.splice(i, 1);
      if (spec.effect === 'flash') this.flashbang(g.id, g.s.x, g.s.y, g.s.z, spec, now);
      else if (spec.effect === 'smoke') this.smokeScreen(g.id, g.s.x, g.s.y, g.s.z, spec, now);
      else this.explode(g.id, g.s.x, g.s.y, g.s.z, spec.radius, spec.damage, g.owner, 'grenade', now);
    }
  }

  /**
   * Stun grenade: a bang and a blinding flash. Everyone within `radius` is blinded and deafened,
   * fully when close and looking at it; less when far, facing away or behind cover.
   */
  private flashbang(id: number, x: number, y: number, z: number, spec: ThrowSpec, now: number): void {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (const o of this.grid.query(cx, cz, ENTITY_INTEREST_RADIUS_CHUNKS, [])) o.session.sendJson({ t: 'explosion', id, x, y, z, radius: spec.radius, kind: 'flash' });
    this.zombies.alert(x, z, 50, now);
    // Battle royale bots are blinded too (they used to shrug a flashbang off).
    this.bots?.flash(x, y, z, spec.radius, spec.effectMs ?? 3000, now);
    for (const t of this.grid.query(cx, cz, 1, this.scratch)) {
      if (!t.active || t.dead) continue;
      const ex = t.state.x, ey = t.state.y + characterEyeHeight(t.state), ez = t.state.z;
      const dx = x - ex, dy = y + .2 - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
      if (d >= spec.radius) continue;
      const near = 1 - (d / spec.radius) ** 2;
      // Looking at it: full; side-on half; facing away still a quarter (the bang).
      const cp = Math.cos(t.pitch), look = d > .3 ? (-Math.sin(t.yaw) * cp * dx + Math.sin(t.pitch) * dy - Math.cos(t.yaw) * cp * dz) / d : 1;
      const facing = .25 + .75 * Math.max(0, look);
      const covered = d > .3 && this.collision.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d - .2, Mask.LineOfSight, this.blastHit);
      const strength = Math.min(1, near * facing * (covered ? .3 : 1) * 1.3);
      if (strength > .05) t.session.sendJson({ t: 'flashbang', strength: +strength.toFixed(2), ms: spec.effectMs ?? 3000 });
    }
  }

  /** Smoke grenade: a cloud everyone around sees for `effectMs`. */
  private smokeScreen(id: number, x: number, y: number, z: number, spec: ThrowSpec, now: number): void {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    // Bots cannot see through the cloud while it lasts.
    this.bots?.smoke(x, z, spec.radius, now + (spec.effectMs ?? 20000));
    for (const o of this.grid.query(cx, cz, ENTITY_INTEREST_RADIUS_CHUNKS, [])) o.session.sendJson({ t: 'smoke', id, x, y, z, radius: spec.radius, ms: spec.effectMs ?? 20000 });
  }

  /** Blast damage with linear falloff; cover blocks it for players. */
  private explode(id: number, x: number, y: number, z: number, radius: number, damage: number, owner: Player | null, kind: 'grenade' | 'grenade40' | 'rocket', now: number): void {
    this.vehicles.blast(x, y, z, radius, damage, now);
    this.building?.blast(x, y, z, radius, damage);
    this.knock?.blast(x, y, z, radius, now);
    const liveOwner = owner && this.players.get(owner.id) === owner ? owner : null;
    this.vegetation.explode(x, y, z, radius, now);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const near = this.grid.query(cx, cz, ENTITY_INTEREST_RADIUS_CHUNKS, []);
    for (const o of near) o.session.sendJson({ t: 'explosion', id, x, y, z, radius, kind });
    this.zombies.alert(x, z, 60, now);
    // The shock wave follows the fireball out, striking as its front passes (stepShocks).
    this.shocks.push({ x, y: y + .3, z, radius, damage, owner, label: kind === 'grenade' ? 'lựu đạn' : kind === 'rocket' ? 'rocket' : 'lựu đạn 40 mm', start: now, hit: new Set() });
    for (const zb of this.zombies.near(x, z, radius)) {
      if (zb.dead) continue;
      const tx = zb.state.x - x;
      const tz = zb.state.z - z;
      const d = Math.hypot(tx, zb.state.y + 0.6 - (y + 0.3), tz);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      zb.state.vy += 4 * k;
      this.hitZombie(liveOwner, zb, Math.round(damage * k), 'torso', zb.state.x, zb.state.y + 0.8, zb.state.z, tx, tz, 9 * k, now);
    }
    for (const t of this.grid.query(cx, cz, 1, this.scratch)) {
      if (!t.active || t.dead) continue;
      const tx = t.state.x - x;
      const ty = t.state.y + 0.9 - (y + 0.3);
      const tz = t.state.z - z;
      const d = Math.hypot(tx, ty, tz);
      if (d >= radius) continue;
      if (d > 0.3 && this.collision.raycast(x, y + 0.3, z, tx / d, ty / d, tz / d, d, Mask.LineOfSight, this.blastHit)) continue;
      this.damage(owner?.id ?? null, t, Math.round(damage * (1 - d / radius)), 'blast', t.state.x, t.state.y + 0.9, t.state.z, now, kind === 'grenade' ? 'lựu đạn' : kind === 'rocket' ? 'rocket' : 'lựu đạn 40 mm');
    }
    for (const bot of this.bots?.near(x, z, radius) ?? []) {
      const d = Math.hypot(bot.state.x - x, bot.state.y + .9 - (y + .3), bot.state.z - z);
      if (d < radius && this.infection) this.infectionBotDamage(bot, Math.round(damage * (1 - d / radius)), owner?.id ?? null, { x, z }, 'blast', now);
      else if (d < radius) this.bots!.hit(bot, Math.round(damage * (1 - d / radius)), owner?.username ?? (kind === 'grenade' ? 'lựu đạn' : 'vụ nổ'), { x, z }, now, 'blast', owner?.id ?? null);
    }
    if (liveOwner) for (const npc of this.peacefulNpcs()) if (Math.hypot(npc.x - x, npc.z - z) < radius) this.provokeNpc(npc, liveOwner, now);
    // Livestock caught in the blast (credited to the thrower).
    if (liveOwner) for (const animal of this.animals.values()) {
      if (animal.dead) continue;
      const d = Math.hypot(animal.state.x - x, animal.state.y + 0.5 - (y + 0.3), animal.state.z - z);
      if (d >= radius) continue;
      this.hitAnimal(liveOwner, animal, Math.round(damage * (1 - d / radius)), now);
    }
  }

  /** Launcher: spawns a server-simulated round (lobbed 40 mm grenade, rocket or bolt). */
  private tryLaunch(p: Player, spec: GunSpec, now: number, bore?: InputMessage['bore']): void {
    const proj = spec.projectile;
    if (!proj || now < p.fireReadyAt - FIRE_TOLERANCE_MS) return;
    if (p.life.stamina < this.attackStaminaCost(p) || !this.useRound(p)) return;
    this.life.spend(p.life, this.attackStaminaCost(p));
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const s = p.state;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const launch = this.shotBore(p, bore);
    const x = bore ? launch.x : s.x + fx * 0.7;
    const y = launch.y;
    const z = bore ? launch.z : s.z + fz * 0.7;
    // Every round leaves along the bore like a bullet; grenade rounds are slow and drop much sooner.
    const [dx, dy, dz] = spreadDirection(launch.dx, launch.dy, launch.dz, gunSpread(spec, p.aiming ? (now - p.aimStartedAt) / 180 : 0, Math.hypot(s.vx, s.vz), s.prone), Math.random);
    const vx = dx * proj.speed, vy = dy * proj.speed, vz = dz * proj.speed;
    const id = this.nextGrenadeId++;
    this.rounds.push({ id, owner: p, w: p.weapon, spec: proj, damage: spec.damage, knockback: spec.knockback ?? 1, traveled: 0, x, y, z, vx, vy, vz, dieAt: now + proj.maxFlightSec * 1000 });
    this.broadcastNear(p, { t: 'proj', id, ownerId: p.id, w: p.weapon, kind: proj.kind, x, y, z, vx, vy, vz, gravity: proj.gravity });
    this.zombies.alert(x, z, proj.kind === 'bolt' ? 12 : 40, now);
  }

  /** Moves rounds along their arcs; the first body, wall or ground they touch stops them. */
  private stepRounds(now: number): void {
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i]!;
      const ox = r.x, oy = r.y, oz = r.z;
      advanceBallistic(r, r.spec.gravity, r.spec.drag ?? 0, TICK_DT);
      const sx = r.x - ox, sy = r.y - oy, sz = r.z - oz;
      r.x = ox; r.y = oy; r.z = oz;
      const fullLen = Math.hypot(sx, sy, sz) || 1e-6;
      const len = Math.min(fullLen, Math.max(0, (r.spec.maxRange ?? Infinity) - r.traveled));
      const dx = sx / fullLen, dy = sy / fullLen, dz = sz / fullLen;
      const candidates: Combatant[] = [
        ...this.grid.query(Math.floor(r.x / CHUNK_SIZE), Math.floor(r.z / CHUNK_SIZE), Math.ceil((len + 3) / CHUNK_SIZE), this.scratch).filter((t) => !this.allied(r.owner, t)),
        ...this.zombies.near(r.x, r.z, len + 3).filter((z) => !r.pierced?.has(z)),
        ...this.animals.values(),
        ...(this.bots?.near(r.x, r.z, len + 3) ?? []),
      ];
      let hit = castCombatRay(r.owner, candidates, this.collision, now, undefined, r.x, r.y, r.z, dx, dy, dz, len);
      // Launcher rounds stop on a vehicle's body, not only on its frame (open windows, cabin).
      if (r.spec.kind !== 'bullet') {
        const hull = this.vehicles.hull(r.x, r.y, r.z, dx, dy, dz, Math.min(len, hit.t), r.owner.vehicleId);
        if (hull && hull.t < hit.t) hit = { target: null, zone: null, t: hull.t, rewoundMs: 0, normal: [-dx, -dy, -dz], colliderTag: 50000 + hull.id };
      }
      // Tyres: a round that meets one first pops it and stops there.
      const tyre = this.vehicles?.tyreOnRay?.(r.x, r.y, r.z, dx, dy, dz, Math.min(len, hit.t));
      if (tyre) { this.vehicles.puncture(tyre.v, tyre.wheel); hit = { target: null, zone: null, t: tyre.t, rewoundMs: 0, normal: [-dx, -dy, -dz], colliderTag: 50000 + tyre.v.id }; }
      const npcHit = this.npcOnRay(r.x, r.y, r.z, dx, dy, dz, hit.t);
      if (npcHit && this.players.get(r.owner.id) === r.owner) this.provokeNpc(npcHit.npc, r.owner, now);
      const t = npcHit ? npcHit.t : hit.t;
      // Survival: a heavy round (40+ damage) goes through an ordinary zombie and flies on weaker.
      const owner0 = this.players.get(r.owner.id) === r.owner ? r.owner : null;
      if (!this.arena && !npcHit && owner0 && hit.zone && hit.target instanceof Zombie && hit.target.variant !== ZombieVariant.Brute && r.spec.kind === 'bullet' && !r.spec.blast && r.damage >= 40) {
        const k = Math.hypot(r.vx, r.vz) || 1;
        const px = r.x + dx * t, py = r.y + dy * t, pz = r.z + dz * t;
        this.hitTarget(owner0, hit.target, Math.round(r.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]), hit.zone, px, py, pz, r.vx / k, r.vz / k, r.damage * .12 * r.knockback, now, r.knockback, r.w);
        (r.pierced ??= new Set()).add(hit.target);
        r.damage = Math.round(r.damage * .6);
        r.x = px; r.y = py; r.z = pz; r.traveled += t;
        continue;
      }
      let stopped = !!npcHit || !!hit.target || hit.t < len - 1e-4;
      const nx = r.x + dx * t;
      const ny = r.y + dy * t;
      const nz = r.z + dz * t;
      const ground = this.collision.terrainHeight(nx, nz);
      if (Number.isFinite(ground) && ny <= ground) {
        stopped = true;
      }
      r.x = nx;
      r.y = r.spec.kind === 'bullet' ? ny : Number.isFinite(ground) ? Math.max(ny, ground + 0.05) : ny;
      r.z = nz;
      r.traveled += t;
      const expired = now >= r.dieAt || r.traveled >= (r.spec.maxRange ?? Infinity) - 1e-5;
      if (!stopped && !expired) continue;
      this.rounds.splice(i, 1);
      if (stopped && !hit.target && !npcHit) { this.vehicles.hitAt(r.x, r.y, r.z, r.damage, now, hit.colliderTag); this.building?.bulletHit(hit.colliderTag, r.damage, r.x, r.y, r.z); if (hit.colliderTag) this.knock?.bullet(hit.colliderTag, r.x, r.y, r.z, dx, dy, dz, r.damage, now); }
      const owner = this.players.get(r.owner.id) === r.owner ? r.owner : null;
      this.broadcastAt(r.x, r.z, { t: 'projEnd', id: r.id, x: r.x, y: r.y, z: r.z, hit: !npcHit && !!hit.target, impact: stopped, normal: !npcHit && !hit.target && stopped ? hit.normal : undefined });
      if (r.spec.blast) {
        this.explode(r.id, r.x, r.y, r.z, r.spec.blast.radius, r.spec.blast.damage, r.owner, r.spec.kind === 'rocket' ? 'rocket' : 'grenade40', now);
      } else if (!npcHit && hit.target && hit.zone && owner) {
        const k = Math.hypot(r.vx, r.vz) || 1;
        this.hitTarget(owner, hit.target, Math.round(r.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]), hit.zone, r.x, r.y, r.z, r.vx / k, r.vz / k, r.damage * .12 * r.knockback, now, r.knockback, r.w);
      }
    }
  }

  /** Flamethrower: a short cone of fire; zombies caught in it keep burning for a while. */
  private tryFlame(p: Player, spec: GunSpec, now: number, bore?: InputMessage['bore']): void {
    if (now < p.fireReadyAt - FIRE_TOLERANCE_MS) return;
    if (p.life.stamina < this.attackStaminaCost(p) || !this.useRound(p)) return;
    this.life.spend(p.life, this.attackStaminaCost(p));
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const { x: ox, y: oy, z: oz, dx: fx, dy: fy, dz: fz } = this.shotBore(p, bore);
    const inCone = (x: number, y: number, z: number): boolean => {
      const dx = x - ox;
      const dz = z - oz;
      const dy = y - oy;
      const d = Math.hypot(dx, dy, dz);
      if (d > spec.range || d < 0.05) return d < 0.05;
      const cos = (dx * fx + dy * fy + dz * fz) / d;
      if (cos < Math.cos(spec.spread + Math.atan(0.45 / d))) return false;
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
    for (const animal of this.animals.values()) {
      if (!animal.active || animal.dead || !inCone(animal.state.x, animal.state.y + .5, animal.state.z)) continue;
      this.hitAnimal(p, animal, spec.damage, now, animal.state.x, animal.state.y + .5, animal.state.z, true);
      if (spec.burn && !animal.dead) {
        animal.burnUntil = now + spec.burn.seconds * 1000;
        animal.burnBy = p; animal.burnDps = spec.burn.dps;
        if (animal.burnAt < now) animal.burnAt = now + 500;
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
    for (const animal of this.animals.values()) {
      if (this.lifeBusy || animal.dead || animal.burnUntil <= now || now < animal.burnAt) continue;
      animal.burnAt = now + 500;
      const owner = animal.burnBy && this.players.get(animal.burnBy.id) === animal.burnBy ? animal.burnBy : null;
      this.hitAnimal(owner, animal, Math.max(1, Math.round(animal.burnDps * .5)), now, animal.state.x, animal.state.y + .5, animal.state.z, true);
    }
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
    if (p.reloadUid && p.inv.equippedItem()?.uid !== p.reloadUid) p.cancelReload();
    p.armor = p.inv.worn();
    p.speedMul = this.infection?.isZombie(p.id) ? this.infectionRules.zombieSpeed : armorSpeedFactor(p.armor) * weaponSpeedFactor(WEAPON_BY_ITEM[p.inv.equippedItem()?.itemId ?? ''] ?? 0);
    const gear = packGear(p.inv.gear(), (id) => WEAPON_BY_ITEM[id] ?? 0);
    p.backWeapon = gear.back; p.gearPacked = gear.gear; p.packWorn = gear.pack;
    p.dirty = true;
  }

  /** Takes one round from the magazine of the gun in hand; false if it is empty or reloading. */
  private useRound(p: Player): boolean {
    const gun = p.inv.equippedItem();
    // A tube being loaded shell by shell: firing (with a shell in) stops the loading.
    const spec = gun ? weaponSpec(WEAPON_BY_ITEM[gun.itemId] ?? 0) : undefined;
    if (gun && p.reloadAt && spec?.kind === 'gun' && spec.shellReload && (gun.mag ?? 0) > 0) p.cancelReload();
    if (!gun || p.reloadAt || (gun.mag ?? 0) <= 0) return false;
    gun.mag = (gun.mag ?? 0) - 1;
    p.dirty = true;
    return true;
  }

  private effort(p: Player): number {
    return armorStaminaFactor(p.armor) * weaponStaminaFactor(WEAPON_BY_ITEM[p.inv.equippedItem()?.itemId ?? ''] ?? 0);
  }

  private attackStaminaCost(p: Player): number { return weaponAttackStaminaCost(WEAPON_BY_ITEM[p.inv.equippedItem()?.itemId ?? ''] ?? 0, this.life.config.stamina.attack, armorStaminaFactor(p.armor)); }

  /** Reload: after (most of) the gun's reload time, rounds move from boxes into the magazine. */
  private onReload(p: Player): void {
    const gun = p.inv.equippedItem();
    const spec = gun ? weaponSpec(WEAPON_BY_ITEM[gun.itemId] ?? 0) : undefined;
    if (!gun || spec?.kind !== 'gun' || p.reloadAt || p.dead) return;
    if ((gun.mag ?? 0) >= spec.magazine || (!this.infection && p.inv.ammoFor(gun.itemId) <= 0)) return;
    p.reloadUid = gun.uid;
    // Lenient: clients time reloads to their sound, so the server only enforces half the time.
    p.reloadAt = this.serverTime + (spec.shellReload ? spec.shellReload.firstMs + spec.shellReload.shellMs : spec.reloadMs) * 0.5;
  }

  private stepReloads(now: number): void {
    for (const p of this.activeScratch) {
      if (p.questBusy || !p.reloadAt || now < p.reloadAt) continue;
      const reloadUid = p.reloadUid;
      p.cancelReload();
      const gun = p.inv.equippedItem();
      const spec = gun ? weaponSpec(WEAPON_BY_ITEM[gun.itemId] ?? 0) : undefined;
      // Swapping weapons cancels the reload.
      if (!gun || gun.uid !== reloadUid || spec?.kind !== 'gun') continue;
      if (spec.shellReload) {
        // One shell into the tube; the next follows while there is room and shells.
        gun.mag = (gun.mag ?? 0) + (this.infection ? 1 : p.inv.takeAmmo(gun.itemId, 1));
        if (gun.mag < spec.magazine && (this.infection || p.inv.ammoFor(gun.itemId) > 0)) {
          p.reloadUid = gun.uid;
          p.reloadAt = now + spec.shellReload.shellMs * .5;
        }
        p.dirty = true;
        this.sendInv(p);
        continue;
      }
      // Infection: unlimited ammunition, but the magazine still has to be reloaded.
      gun.mag = this.infection ? spec.magazine : (gun.mag ?? 0) + p.inv.takeAmmo(gun.itemId, spec.magazine - (gun.mag ?? 0));
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
      case 'sort':
        if (isStash(msg.c) && !this.atStorage(p)) break;
        changed = p.inv.sort(msg.c);
        break;
      case 'equip':
        changed = p.inv.equip(msg.uid);
        if (changed) p.cancelReload();
        break;
      case 'chestDrop': {
        // Only from the chest this player has open; the chest's viewers see it go.
        if (this.chests.viewing(p) !== msg.id) break;
        for (const it of this.chests.takeLive(msg.id, (items) => items.some((i) => i.uid === msg.uid) ? [msg.uid] : []) ?? []) this.dropGroundItem(p, it);
        break;
      }
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
      case 'attach':
        changed = p.inv.attach(msg.gun, msg.uid);
        if (!changed) this.reply(p, 'Phụ kiện này không lắp được lên súng đó.');
        break;
      case 'detach':
        changed = p.inv.detach(msg.gun, msg.slot);
        if (!changed) this.reply(p, 'Túi đồ không đủ chỗ để tháo phụ kiện.');
        break;
      case 'pickup': {
        const g = this.groundItems.get(msg.id);
        // Within reach on the player's own floor, nothing solid in between (never through a floor).
        if (!g || Math.hypot(p.state.x - g.x, p.state.z - g.z) > GROUND_PICKUP_REACH || Math.abs(p.state.y - g.y) > 1.6) break;
        {
          const ey = p.state.y + 1.1, dx = g.x - p.state.x, dy = g.y + .35 - ey, dz = g.z - p.state.z, d = Math.hypot(dx, dy, dz);
          if (d > .3 && this.collision.raycast(p.state.x, ey, p.state.z, dx / d, dy / d, dz / d, d, Mask.CharacterMovement, this.pickupHit) && this.pickupHit.t < d - .5) break;
        }
        const added = p.inv.add(g.itemId, g.count, g.issued);
        if (!added) {
          p.session.sendJson({ t: 'error', code: 'invalid_message', message: 'Inventory full', fatal: false });
          break;
        }
        if (g.mag !== undefined) added.mag = g.mag;
        if (g.quest) added.quest = g.quest;
        if (g.attachments) added.attachments = { ...g.attachments };
        // A backpack comes back with everything that was packed inside it.
        p.inv.restoreContents(added.uid, g.contents);
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
    const crate = this.deathCrates.get(id);
    if (crate) return Math.hypot(crate.x - p.state.x, crate.z - p.state.z) <= CHEST_REACH && Math.abs(crate.y - p.state.y) <= 2.5 ? { field: false } : null;
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

  private dropGroundItem(p: Player, it: { itemId: string; count?: number; mag?: number; issued?: boolean; quest?: string; attachments?: Attachments; contents?: PlacedItem[] }): void {
    const id = this.nextGroundId++;
    const a = p.yaw + (Math.random() - 0.5) * 0.8;
    const d = 0.9 + Math.random() * 0.5;
    const x = p.state.x - Math.sin(a) * d;
    const z = p.state.z - Math.cos(a) * d;
    const ground = this.collision.terrainHeight(x, z);
    const y = Number.isFinite(ground) && Math.abs(ground - p.state.y) < 1.5 ? ground : p.state.y;
    const g = { itemId: it.itemId, count: it.count, mag: it.mag, issued: it.issued, quest: it.quest, ...(it.attachments ? { attachments: { ...it.attachments } } : {}), ...(it.contents?.length ? { contents: it.contents } : {}), x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), expiresAt: this.battle ? Infinity : this.serverTime + GROUND_ITEM_LIFETIME_MS };
    this.groundItems.set(id, g);
    this.broadcast({ t: 'ground', items: [{ id, itemId: g.itemId, count: g.count, x: g.x, y: g.y, z: g.z }] });
  }

  /** An item lying at an exact spot (mined ore, planks that did not fit). */
  private spawnGroundItem(itemId: string, count: number | undefined, x: number, y: number, z: number): void {
    const id = this.nextGroundId++;
    const g = { itemId, count, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), expiresAt: this.serverTime + GROUND_ITEM_LIFETIME_MS * 3 };
    this.groundItems.set(id, g);
    this.broadcast({ t: 'ground', items: [{ id, itemId, count, x: g.x, y: g.y, z: g.z }] });
  }

  /** A supply crate touched down: a chest anyone may open (the drop zone is not protected). */
  private landSupplyCrate(entries: Array<[string, number]>, x: number, y: number, z: number): void {
    const items: PlacedItem[] = [];
    let uid = 1;
    for (const [itemId, n] of entries) for (let i = 0; i < n; i++) {
      const def = ITEMS[itemId];
      if (!def) continue;
      const item: PlacedItem = { uid: uid++, itemId, container: 'backpack', x: 0, y: 0, rotated: false };
      const max = maxCount(def);
      if (max) item.count = max;
      const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
      if (spec?.kind === 'gun') item.mag = spec.magazine;
      items.push(item);
    }
    const id = `9998:${this.nextSupplyCrate++}:${Math.round(this.serverTime) % 1_000_000}:0`;
    this.supplyChests.set(id, { items, searched: true, revision: 0, capacity: Math.max(24, items.length) });
    this.deathCrates.set(id, { id, x, y, z });
    this.broadcast({ t: 'lootCrates', crates: [...this.deathCrates.values()] });
  }

  /** Base building requests (see BaseBuilding). */
  private onBuild(p: Player, msg: BuildMessage): void {
    const b = this.building;
    if (!b || !p.active || p.questBusy) return;
    const now = this.serverTime;
    switch (msg.op) {
      case 'place': return b.place(p, msg.uid, msg.x, msg.z, msg.yaw);
      case 'craft': return b.craft(p, msg.uid);
      case 'log': return b.takeLog(p, msg.id, now);
      case 'door': return b.door(p, msg.id, msg.piece, now);
      case 'deposit': return b.deposit(p, msg.blueprint, msg.item);
      case 'claim': return b.claim(p, msg.blueprint);
      case 'order': return b.order(p, msg.entry, now);
    }
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
      const g = { itemId: animal.lootItem, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), expiresAt: this.serverTime + GROUND_ITEM_LIFETIME_MS, livestock: true };
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
    const npcs: Array<{ id: number; role: 'merchant' | 'nurse' | 'architect'; x: number; z: number }> = [];
    if (this.architect.active) npcs.push({ id: this.architect.id, role: 'architect', x: this.architect.x, z: this.architect.z });
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
    const price = it && def && !it.issued && !it.quest ? sellPrice(it.itemId, max ? (it.count ?? max) / max : 1)
      + Object.values(it.attachments ?? {}).reduce((sum, id) => sum + sellPrice(id, 1), 0) : 0;
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
      p.session.sendJson({ t: 'c4', charges: [...this.c4Charges.values()]
        .filter(c => Math.abs(Math.floor(c.s.x / CHUNK_SIZE) - p.chunkX) <= ENTITY_INTEREST_RADIUS_CHUNKS && Math.abs(Math.floor(c.s.z / CHUNK_SIZE) - p.chunkZ) <= ENTITY_INTEREST_RADIUS_CHUNKS)
        .map(c => c.pose()) });
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
          gear: o.gearPacked,
          pack: o.packWorn,
          armor: packArmor(o.armor),
          att: packAttachments(o.inv.equippedItem()?.attachments),
        });
      }
      this.guards.entitiesFor(p, entities);
      this.bots?.entitiesFor(p, now, entities);
      for (const [key, entity] of this.questNpcs) {
        const start = entities.length;
        entity.entitiesFor(p, entities);
        if (entities.length > start) entities[start]!.weapon = this.content.npcs.find((n) => n.id === key)?.weapon ?? 0;
      }
      this.merchant.entitiesFor(p, entities);
      this.nurse.entitiesFor(p, entities);
      if (!this.arena) this.architect.entitiesFor(p, entities);
      this.zombies.entitiesFor(p, now, entities);
      for (const animal of this.animals.values()) if (animal.visible(p)) entities.push(animal.entity(now));
      const s = p.state;
      const frame = encodeSnapshot({
        tick: this.tick,
        serverTime: now,
        timeOfDay: tod,
        ackSeq: p.lastProcessedSeq,
        self: { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, flags: this.flagsOf(p, now), health: p.downed ? Math.max(1, Math.ceil(p.bleed)) : p.health, stuckTicks: s.stuckTicks, rollTicks: s.rollTicks, rollCooldown: s.rollCooldown, rollYaw: s.rollYaw, lungeTicks: s.lungeTicks ?? 0 },
        entities,
      });
      p.session.sendBinary(frame, true);
    }
  }

  private flagsOf(p: Player, now: number): number {
    let f = 0;
    if (p.state.flight === 1) f |= EntityFlags.InPlane;
    if (p.state.flight === 2) f |= EntityFlags.Freefall;
    if (p.state.flight === 3) f |= EntityFlags.Parachute;
    if (p.state.grounded) f |= EntityFlags.Grounded;
    if (p.state.swimming) f |= EntityFlags.Swimming;
    if (p.dead) f |= EntityFlags.Dead;
    if ((p.lastButtons & Buttons.Sprint) !== 0) f |= EntityFlags.Sprinting;
    if (now < p.attackingUntil) f |= EntityFlags.Attacking;
    if (p.state.rollTicks > 0) f |= EntityFlags.Rolling;
    if (p.state.prone) f |= EntityFlags.Prone;
    if (p.state.crouched) f |= EntityFlags.Crouching;
    const lean = leanOf(p.lastButtons);
    if (lean < 0) f |= EntityFlags.LeanLeft; else if (lean > 0) f |= EntityFlags.LeanRight;
    if (p.aiming && !p.dead && !p.downed) f |= EntityFlags.Aiming;
    if (p.inv.hasFlashlight()) f |= EntityFlags.Flashlight;
    if ((p.lastButtons & Buttons.Prime) !== 0 && weaponSpec(p.weapon)?.kind === 'throw') f |= EntityFlags.Priming;
    if (p.state.climbing) f |= EntityFlags.Climbing;
    if (p.state.mantle) f |= EntityFlags.Mantling;
    if ((p.lastButtons & Buttons.Plan) !== 0 && !this.arena) f |= EntityFlags.Planning;
    if (p.downed) f |= EntityFlags.Downed;
    if (p.reviving) f |= EntityFlags.Reviving;
    if (now < p.knockedUntil && !p.dead) f |= EntityFlags.Knocked;
    if (p.bandaging && !p.dead && !p.vehicleId) f |= EntityFlags.Healing;
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

  /** A kill for the scoreboard (`killer` null or the victim itself: only the death counts). */
  private credit(killer: number | null, victim: number): void {
    const s = (id: number) => { let v = this.stats.get(id); if (!v) this.stats.set(id, v = { kills: 0, deaths: 0 }); return v; };
    s(victim).deaths++;
    if (killer !== null && killer !== victim) s(killer).kills++;
    this.statsDirty = true;
  }

  private broadcastPlayerList(): void {
    this.statsDirty = false;
    const score = (id: number) => this.stats.get(id) ?? { kills: 0, deaths: 0 };
    const zombie = (id: number) => this.infection?.zombies.has(id) ?? false;
    const players = [...this.players.values()].map((p) => ({ id: p.id, name: p.username, rank: p.rank, pvp: p.pvpEnabled, ...score(p.id), dead: p.dead || (this.battle?.eliminated.has(p.id) ?? false), zombie: zombie(p.id), ...(p.look ? { look: p.look } : {}) }));
    for (const bot of this.bots?.bots ?? []) players.push({ id: bot.id, name: bot.name, rank: { step: 0, tier: 0, stars: 1, title: 'Tân Binh I' }, pvp: false, ...score(bot.id), dead: bot.dead, zombie: zombie(bot.id), bot: true } as (typeof players)[number]);
    this.broadcast({ t: 'players', players });
  }

  /* ------------------------------------ persistence -------------------------------------- */

  private async persistAll(all: boolean): Promise<void> {
    if (this.arena) return;
    const batch = [];
    for (const p of this.players.values()) {
      if (p.questBusy || (!all && !p.dirty)) continue;
      p.dirty = false;
      batch.push({ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life), suspendedZombies: p.suspendedZombies });
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
