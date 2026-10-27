import { BLADE_COMBO, carriedGear, unpackGear, acceptsAttachments, attachmentModifier, opticOf, unpackAttachments, weaponAttackStaminaCost, type RankTitle } from '@zion/shared';
import { voice } from '@/lib/voice';
import { ZombieOutline } from './render/zombie-outline';
import { VehicleRenderer } from './render/vehicles';
import { VEHICLES, vehicleSeatOf } from '@zion/shared';
import { TargetVisibility } from './target-visibility';
import { BattleZone } from './render/battle-zone';
import type { GameMode } from '@zion/shared';
import { INFECTION } from '@zion/shared';
import { loadInfectionLoadout } from '@/lib/infection-loadout';
import { clearActiveMatch, markActiveMatch, rejoinAttempt, rejoinSucceeded } from '@/lib/rejoin';
import { ZombieVariant, zombieScale, CHEST_ASSETS, CHEST_REACH, chestKey, ZOMBIE_BUCKET } from '@zion/shared';
import type { ClientMessage } from '@zion/shared';
import { settingsStore, type CameraMode } from '@/lib/settings';
import { ThirdPersonCamera, reticleAim } from './third-person-camera';
import { mobileAimScore } from './mobile-aim';
import { zombieAimPoint } from './zombie-aim';
import { scopeFov } from './scope';
import { ScopeLens } from './render/scope-lens';
import { AimSway } from './aim-sway';
import { ThrowArc, type ArcLaunch } from './render/throw-arc';
import { reloadScriptOf, type PartSound } from './reload-scripts';
import { Compass, type CompassMark } from './render/compass';
import { NearBlur } from './render/near-blur';
import { ROCK_MOSS } from './render/natural-material';
import { CHUNK_SIZE as MOSS_CHUNK, chunkKey as mossChunkKey, lodStep } from '@zion/shared';
import { handAnimationFor } from './hand-studio';
import { GunRecoil, weaponRecoil } from './first-person-recoil';
import { applyFirstPersonRoll } from './render/first-person-roll';
import { ViewModel } from './render/viewmodel';
import { groundMaterial } from './render/natural-material';
import { GroundTextures } from './render/ground-textures';
import { Shockwaves } from './render/shockwave';
import { BaseLifeRenderer } from './render/base-life';
import { NPC_MODELS, type QuestNpcMessage } from '@zion/shared';
import {
  ACESFilmicToneMapping,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineDashedMaterial,
  CircleGeometry,
  MeshBasicMaterial,
  RingGeometry,
  Group,
  Mesh,
  PCFSoftShadowMap,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type ShaderMaterial,
  PointLight,
  SpotLight,
  Ray,
} from 'three';
import {
  CHUNK_SIZE,
  EntityFlags,
  INTERPOLATION_DELAY_MS,
  LOD_RINGS,
  RESPAWN_DELAY_MS,
  TICK_DT,
  chunkKey,
  type ChunkData,
  type ServerJsonMessage,
  type Snapshot,
  type InputMessage,
  type WelcomeMessage,
  type HitEvent,
  EntityKind,
  MERCHANT_MODEL_URL,
  MERCHANT_NAME,
  NURSE_MODEL_URL,
  NURSE_NAME,
  NURSE_HEAL_PRICE,
  MERCHANT_REACH,
  ARMOR_BY_ID,
  ARMOR_SLOTS,
  armorSpeedFactor,
  armorVision,
  armorHearing,
  weaponSpeedFactor,
  weaponStaminaFactor,
  armorStaminaFactor,
  Limb,
  unpackArmor,
  type ArmorLoadout,
  MEDKIT_USE_MS,
  PLAYER_MAX_HEALTH,
  weaponSpec,
  type WalletEvent,
  guardName,
  isZombieId,
  Buttons,
  ITEM_BY_WEAPON,
  muzzleHeight,
  leanOf,
  leanOffset,
  aimedThrowSpeed,
  elevationFor,
  GRENADE_GRAVITY,
  WEAPON_BY_ITEM,
  WEAPON_SPECS,
  WeaponId,
  propTransform,
} from '@zion/shared';
import { DEFAULT_CHARACTER, characterEyeHeight, Mask, makeRayHit, raycastRig, zombieHitRig, PRONE_RIG, MANTLE_CLIPS, mantlePlan, mantleSample } from '@zion/physics';
/** A recording's foot bone (the ankle) above the sole (m). */
const MANTLE_ANKLE = .08;
import { CAMP_ASSET, createDefaultRegistry, type AssetDefinitionInput, type AssetRegistry } from '@zion/assets';
import type { HudState, HudStore, LifeState } from './hud-store';
import { itemName, translateMsg, type Msg } from '@/lib/i18n';
import type { InventoryStore } from './inventory/inventory';
import { InputController, type TouchAction, type TouchButton } from './input';
import { RemoteEntity } from './interpolation';
import { GameConnection } from './net/connection';
import { ServerClock } from './net/clock';
import { LocalPlayer } from './prediction';
import { BattleFlightRenderer } from './render/battle-flight';
import { SquadMarkers } from './render/squad-markers';
import { PowerCables } from './render/power-cables';
import { doorColliders } from '@zion/physics';
import { BATTLE_FLIGHT, BATTLE_TIME_OF_DAY, battleCircleAt, battlePlaneAt, type BattleState } from '@zion/shared';
import { AssetLibrary, windUniforms } from './render/asset-library';
import { ResourceDisposer } from './render/resources';
import { Avatar, type MantleClipPose } from './render/avatars';
import { loadPlayerCharacter, type CharacterTemplate } from './render/character-model';
import { BuildingController } from './building-controller';
import { MeleeFeel, type MeleeFeelFrame } from './melee-feel';
import { ShaderPack } from './render/shader-pack';
import { weaponOptic } from '@zion/shared';
import { ARCHITECT_MODEL_URL, ARCHITECT_NAME } from '@zion/shared';
import { BLADE_COMBO_WEAPONS, EDGED_MELEE_WEAPONS, LONG_LUNGE_CLIP, bladeStepTiming, meleeSwing, type MeleeSpec } from '@zion/shared';
import { DEFAULT_APPEARANCE, randomAppearance, sameAppearance, type Appearance } from '@zion/shared';
import { cachedLook, loadLook } from '@/lib/appearance';
import { prepareGuardModel } from './render/guard-model';
import { loadZombieClips } from './render/zombie-clips';
import { occlusionUniforms } from './render/occlusion-fade';
import { loadWeapons, type WeaponLibrary } from './render/weapons';
import { CombatEffects } from './render/effects';
import { itemIcons, renderItemIcons } from './inventory/icons';
import { clearPending, markPending } from './pending';
import { ITEMS } from './inventory/items';
import { WeaponController } from './weapon-controller';
import { ammoItemFor } from './inventory/items';
import type { PlacedItem } from './inventory/inventory';
import { SoundBank, type SoundName } from './audio';
import { zombieVariant } from '@zion/shared';
import { ZOMBIE_MODEL_URLS, ZombieAvatar, type LastHit } from './render/zombie-avatar';
import { loadZombieModel, zombieTemplateIndex } from './render/zombie-model';
import { DebrisSystem } from './render/debris';
import { ColliderDebug } from './render/collider-debug';
import { ParticleFX } from './render/particles';
import { Minimap } from './render/minimap';
import { CampLights } from './render/camp-lights';
import { lookDirection } from './render/offhand-light';
import { PICKUP_REACH, GroundItems } from './render/ground-items';
import { CharacterPreview } from './render/character-preview';
import { requestArmor } from './render/armor-models';
import { SlashEffects, type SlashPose } from './render/slash';
import { WorldMapStore } from './world-map';
import { GuardFlashlights, type FlashlightPose } from './render/guard-flashlights';
import { PropRenderer } from './render/props';
import { SkySystem } from './render/sky';
import { buildTerrainGeometry, buildWaterGeometry } from './render/terrain';
import { VegetationRenderer } from './render/vegetation';
import { planCooking } from '@zion/shared';
import { createOceanGeometry, createWaterMaterial, getWaterUniforms, snapOcean } from './render/water';
import { ChunkStore } from './world/chunk-store';
import { VISION_HALF_ANGLE, VisionCone } from './vision-cone';
import { FrameProfiler } from './frame-profiler';

interface ChunkMeshes {
  chunk: ChunkData;
  terrain: Mesh;
  water: Mesh | null;
}

/** The infected's sniff: survivors within `range` m show through walls for `ms`. */
const SNIFF = { range: 10, ms: 6000, cooldownMs: 20_000 } as const;
const MESH_BUILD_BUDGET_MS = 6;
const HUD_INTERVAL_MS = 250;
const PING_INTERVAL_MS = 2000;
/** Top-down camera (Minecraft Dungeons style): fixed diagonal yaw, steep pitch. */
const CAM_YAW = Math.PI / 4;
const CAM_PITCH = 52 * (Math.PI / 180);
/** Fixed camera distance: a medium-wide view. */
const CAM_DIST = 17;
/** First-person lens (degrees); scoped FOV comes from each weapon's magnification. */
const FP_FOV = 75;

/** Sniper scope: how far the view pans towards the cursor, how fast, and the extra zoom-out. */
const SCOPE_PAN_GAIN = 0.55;
/** Most the shot may turn from the gun's own bore towards the aimed point (rad). */
const AIM_CORRECTION_MAX = .17;
const SCOPE_PAN_MAX = 26;
const SCOPE_PAN_RATE = 2.2;
const SCOPE_EXTRA_DIST = 6;
/** Reach of the E prompt around an ammo cache station's centre. */
const STATION_REACH = 3.6;
/** Camp NPCs closer than this (m) but off screen get an edge-of-screen guide arrow. */
const GUIDE_RANGE = 200;
/** Grenade-launcher aim marker radius (m): just shows where the round lands. */
const LAUNCHER_MARKER_RADIUS = 0.6;

/**
 * Cursor distance → barrel elevation: close to the character aims down at the ground, mid range
 * is level, far away tilts the barrel up.
 */
function aimPitch(dist: number): number {
  // Gentle: most of the screen keeps the barrel near chest/head height of targets.
  const NEAR = 1.2;
  const LEVEL = 4.5;
  const FAR = 22;
  if (dist <= LEVEL) return -0.32 * Math.min(1, Math.max(0, (LEVEL - dist) / (LEVEL - NEAR))) ** 1.5;
  return 0.07 * Math.min(1, (dist - LEVEL) / (FAR - LEVEL));
}

/**
 * Client engine: presentation only. Renders what the server streams, captures input, predicts
 * the local player with the shared controller and interpolates everyone else. It never decides
 * game outcomes — the server's snapshot always wins.
 */
/** Something within reach the player can use: where it is, what it is called, what it does. */
interface Interactable {
  kind: 'door' | 'chest' | 'ground' | 'revive' | 'talk' | 'life' | 'storage' | 'shop' | 'nurse' | 'cache' | 'vehicle' | 'trunk' | 'architect' | 'hint';
  x: number; y: number; z: number;
  /** How close the cursor ray must pass (m). */
  radius: number;
  label: Msg;
  name?: string;
  ground?: { id: number; itemId: string; count?: number };
  run: () => void;
}

export class GameEngine {
  private vehicles: VehicleRenderer | null = null;
  private drivingYaw: number | null = null;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly squadMarkers = new SquadMarkers(this.scene);
  private readonly camera = new PerspectiveCamera(40, 1, 0.5, 2600);
  private readonly registry: AssetRegistry = createDefaultRegistry();
  private readonly library = new AssetLibrary(this.registry, { game: true });
  private readonly resources = new ResourceDisposer();
  private readonly ownedModels = new Set<Object3D>();
  private readonly subscriptions: Array<() => void> = [];
  private readonly clock = new ServerClock();
  private readonly conn: GameConnection;
  private readonly input: InputController;
  private readonly resize: ResizeObserver;
  private readonly terrainMaterial = groundMaterial();
  private readonly groundTextures = new GroundTextures(this.terrainMaterial);
  /** Blast shock waves: clear spheres bending the light as they race out. */
  private readonly shockwaves = new Shockwaves();
  private readonly terrainGroup = new Group();
  private readonly meshes = new Map<number, ChunkMeshes>();
  private readonly buildQueue = new Map<number, ChunkData>();
  private readonly remotes = new Map<number, { entity: RemoteEntity; avatar: Avatar; weapon: number; back?: number; gear?: number; pack?: number; att?: number; attacking?: boolean; armor?: number; burnUntil?: number; outfit?: ArmorLoadout }>();
  /** Shop trades waiting for the server's wallet answer: request id → what to do on success. */
  private readonly trades = new Map<number, { buy?: string; sellUid?: number; heal?: boolean }>();
  private nextTrade = 1;
  private nearMerchant = false;
  /** Armour worn last time we told the server / dressed the model ('' = never). */
  private armorKey = '';
  private preview: CharacterPreview | null = null;
  /** This player's character look, and every other player's (from the player list). */
  private look: Appearance = DEFAULT_APPEARANCE;
  private readonly looks = new Map<number, Appearance>();
  private nearNurse = false;
  private nearArchitect = false;
  /** Graphics option: the post-processing shader pack (null while off). */
  private shaderPack: ShaderPack | null = null;
  /** Frame time split (F3): update, render submit, GPU. */
  private profiler: FrameProfiler | null = null;
  /** Melee juice: hit-stop, camera punch, layered sounds, combos (cosmetic). */
  private readonly meleeFeel = new MeleeFeel((name, volume, rate) => this.sounds?.play(name, { volume, rate }));
  private feel: MeleeFeelFrame = { timeScale: 1, yaw: 0, pitch: 0, roll: 0, fov: 0, shake: 0, push: 0 };
  /** Survival base building (trees, structures, blueprints, supply drops). */
  private building: BuildingController | null = null;
  private architectTemplate: CharacterTemplate | null = null;
  /** Camp service NPCs (from the server), for the minimap and edge-of-screen guides. */
  private npcs: Array<{ id: number; role: 'merchant' | 'nurse' | 'architect'; x: number; z: number }> = [];
  private lastGuides = 0;
  private readonly guideTmp = new Vector3();
  /** First aid kit being applied: which one and when it started (ms). */
  private healing: { uid: number; start: number } | null = null;
  /** Last hit that interrupts first aid (zone damage does not). */
  private healBreakAt = 0;
  private wasAiming = false;
  /**
   * Bullet crack: someone else's round passing close to our head. Plays when the round reaches
   * its closest point, positioned there, so the stereo pan says which side it went past.
   */
  private bulletWhiz(m: { x: number; y: number; z: number; vx: number; vy: number; vz: number; maxFlightSec?: number }): void {
    const s = this.local?.state;
    if (!s || this.local?.dead || !this.sounds) return;
    const hx = s.x - m.x, hy = s.y + 1.6 - m.y, hz = s.z - m.z, v2 = m.vx * m.vx + m.vy * m.vy + m.vz * m.vz;
    if (v2 < 1) return;
    const t = (hx * m.vx + hy * m.vy + hz * m.vz) / v2;
    if (t <= .005 || t > (m.maxFlightSec ?? 3)) return;
    const px = m.x + m.vx * t, py = m.y + m.vy * t, pz = m.z + m.vz * t;
    const miss = Math.hypot(px - s.x, py - s.y - 1.6, pz - s.z);
    if (miss > 4 || miss < .25) return;
    const name = `bulletPass${1 + Math.floor(Math.random() * 7)}` as SoundName;
    window.setTimeout(() => this.sounds?.play(name, { at: { x: px, y: py, z: pz }, refDistance: 1, maxDistance: 12, volume: 1 - miss / 5, rate: .94 + Math.random() * .12 }), t * 1000);
  }
  /** Crosshair bloom from recent shots (0…1), decaying every frame. */
  private shotBloom = 0;
  private crosshairSpread = -1;
  /** Dynamic crosshair: opens with speed, jumps and recent shots, tightens when aiming. */
  private updateCrosshair(dt: number): void {
    const s = this.local?.state;
    if (!s || typeof document === 'undefined') return;
    this.shotBloom = Math.max(0, this.shotBloom - dt * 2.6);
    const speed = Math.min(1, Math.hypot(s.vx, s.vz) / 6), air = s.grounded || s.swimming ? 0 : .7;
    const spread = Math.min(1, (speed * .55 + air + this.shotBloom) * (this.aiming ? .35 : 1));
    const eased = this.crosshairSpread < 0 ? spread : this.crosshairSpread + (spread - this.crosshairSpread) * Math.min(1, dt * 14);
    if (Math.abs(eased - this.crosshairSpread) < .002) return;
    this.crosshairSpread = eased;
    document.documentElement.style.setProperty('--xh-spread', eased.toFixed(3));
  }
  /** ZCoin dropped by zombies (server-owned; we only show them and ask to pick up). */
  private readonly coinDrops = new Map<number, Object3D>();
  private readonly coinRingGeometry = new RingGeometry(0.28, 0.36, 28);
  private readonly coinRingMaterial = new MeshBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.6, depthWrite: false });
  private readonly weaponCtl: WeaponController;
  /** Sniper scope state: world-space camera pan and the dashed laser (local player only). */
  private scoped = false;
  private aiming = false;
  private readonly scopePan = new Vector3();
  private scopeZoom = 0;
  private laser: Line | null = null;
  private emptyToastAt = 0;
  /** Ammo cache within reach: 'camp' caches issue ammo only. */
  private station: 'field' | 'camp' | null = null;
  private groundItems: GroundItems | null = null;
  private slashes: SlashEffects | null = null;
  private interact = '';
  /** Everything within reach that can be used (refreshed with the station scan). */
  private targets: Interactable[] = [];
  /** The one the cursor / crosshair is on (TOP & third person), or the best one (first person). */
  private hovered: Interactable | null = null;
  /** Peeking round a corner while aiming (TOP & third person): −1 left, 1 right, since when. */
  private autoLean = { side: 0, at: 0 };
  private readonly reachHit = makeRayHit();
  /** Ledges being climbed: where each climber's hands are planted, when it started, the recording it follows. */
  private readonly mantles = new Map<number, { left: Vector3; right: Vector3; start: number; dur: number; kind: 0 | 1; t0: number; wall: Vector3; dir: Vector3; top: number }>();

  /**
   * Where a mantling character's hands grip the edge (world, fixed for the whole climb) and how
   * far along it is. Our own climb is known exactly; others' edges are found by looking ahead.
   */
  private mantleGrip(id: number, flags: number, x: number, y: number, z: number, yaw: number, own?: { t: number; dur: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; kind?: 0 | 1; t0?: number }): { grip: { left: Vector3; right: Vector3 }; k: number; clip: MantleClipPose } | null {
    if (!(flags & EntityFlags.Mantling)) { this.mantles.delete(id); return null; }
    let m = this.mantles.get(id);
    if (!m) {
      let ex: number, ez: number, ey: number, dx: number, dz: number;
      if (own) {
        dx = own.tx - own.fx; dz = own.tz - own.fz;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        ex = own.tx - dx * .47; ez = own.tz - dz * .47; ey = own.ty;
      } else {
        dx = -Math.sin(yaw); dz = -Math.cos(yaw);
        const col = this.store?.collision;
        let reach = .5; ey = y + 1.5;
        if (col && col.raycast(x, y + .6, z, dx, 0, dz, 1.2, Mask.CharacterMovement, this.reachHit)) reach = this.reachHit.t;
        ex = x + dx * reach; ez = z + dz * reach;
        if (col && col.raycast(ex + dx * .15, y + 2.8, ez + dz * .15, 0, -1, 0, 2.6, Mask.CharacterMovement, this.reachHit)) ey = this.reachHit.y;
      }
      // Hands a shoulder-width apart on the very edge.
      const rx = -dz, rz = dx;
      // The recording the climb follows (the same choice as the physics makes).
      // (Measured from the ground, as the physics does: a climb may start in the air.)
      const ground = this.store?.collision.raycast(x, y + .1, z, 0, -1, 0, 3, Mask.CharacterMovement, this.reachHit) ? this.reachHit.y : y;
      const plan = mantlePlan(ey - ground);
      m = { left: new Vector3(ex - rx * .28, ey + .02, ez - rz * .28), right: new Vector3(ex + rx * .28, ey + .02, ez + rz * .28), start: performance.now(), dur: own ? own.dur : plan.dur,
        kind: own?.kind ?? plan.kind, t0: own?.t0 ?? plan.t0, wall: new Vector3(ex, ey, ez), dir: new Vector3(dx, 0, dz), top: ey };
      this.mantles.set(id, m);
    }
    const elapsed = own ? own.t : Math.min(m.dur, (performance.now() - m.start) / 1000);
    const k = Math.min(1, elapsed / m.dur);
    // The recording's hips: its feet's starting level is the top less its climb (plus the ankle
    // above the sole), its hands' edge is the wall's face.
    const table = m.kind ? MANTLE_CLIPS.climb_wall : MANTLE_CLIPS.hang_to_crouch, time = m.t0 + elapsed;
    const hipY = m.top - table.rise.at(-1)! + MANTLE_ANKLE + mantleSample(table, table.hipY, time);
    const ahead = m.wall.x * m.dir.x + m.wall.z * m.dir.z + mantleSample(table, table.hipZ, time) - (x * m.dir.x + z * m.dir.z);
    return { grip: m, k, clip: { kind: m.kind, time, hipHeight: hipY - y, hipAhead: ahead } };
  }
  private readonly doors = new Map<number, { x: number; y: number; z: number; yaw: number; open: boolean }>();
  private lastStationScan = 0;
  private readonly shotRay = makeRayHit();
  private effects: CombatEffects | null = null;
  private lastAmmoKey = '';
  private readonly pvpNames = new Set<number>();
  private readonly names = new Map<number, string>();
  private readonly ranks = new Map<number, RankTitle>();
  private readonly focus = new Vector3();
  private readonly camFocus = new Vector3();
  private camFocusInit = false;
  private readonly raycaster = new Raycaster();
  private readonly aimPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly aimPoint = new Vector3();
  /** The point the crosshair/cursor aims at (third person and top view); shots fly from the
   * real muzzle to it, so the gun's offset from the body's centre does not shift the hit. */
  private readonly aimTarget = new Vector3();
  private aimTargetValid = false;
  private readonly ndc = new Vector2();
  private sounds: SoundBank | null = null;
  private readonly tmpA = new Vector3();
  private readonly listenerPos = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private character: CharacterTemplate | null = null;
  private privateQuestRenderer: BaseLifeRenderer | null = null;
  private lifeRenderer: BaseLifeRenderer | null = null;
  private questNpcDefinitions: QuestNpcMessage['npcs'] = [];
  private nearStorage = false;

  /** The camp warehouse in world space (personal storage), if this world has one. */
  private storagePos(): { x: number; z: number; radius: number } | null {
    const camp = this.welcome?.world.camp;
    const s = this.hud.get().life?.config.storage;
    return camp && s ? { x: camp.x + s.x, z: camp.z + s.z, radius: s.radius } : null;
  }
  private animalTemplates: CharacterTemplate[] = [];
  private animalByModel = new Map<string, CharacterTemplate>();

  /** Animal entity ids encode their type (×16): look its model up in the base-life config. */
  private animalTemplate(id: number): CharacterTemplate | undefined {
    // id = base + (serial << 8) + (type << 4) + n  (serial 0: the camp pen, > 0: wild animals)
    const type = ((id - 0xe0000100) >> 4) & 15;
    const model = this.hud.get().life?.config.animals?.[type]?.model;
    return (model && this.animalByModel.get(model)) || this.animalTemplates[type % Math.max(1, this.animalTemplates.length)];
  }
  private questTemplates = new Map<string, CharacterTemplate>();
  private merchantTemplate: CharacterTemplate | null = null;
  private nurseTemplate: CharacterTemplate | null = null;
  private zombieTemplate: CharacterTemplate | null = null;
  private zombieTemplates: CharacterTemplate[] = [];
  private readonly zombies = new Map<number, { entity: RemoteEntity; avatar: ZombieAvatar; armor?: number; limbs: number; variant: ZombieVariant; leaping?: boolean; voiceAt: number; lastGroan: number; enraged: boolean; dead?: boolean; hurtAt: number; lastHit: LastHit | null; burnUntil?: number }>();
  private debris: DebrisSystem | null = null;
  /** F4: colliders, contacts and aim ray drawn over the world. */
  private colliderDebug: ColliderDebug | null = null;
  private readonly onDebugKey = (e: KeyboardEvent): void => {
    if (e.code !== 'F4' || e.repeat) return;
    e.preventDefault();
    if (!this.colliderDebug) return;
    const on = this.colliderDebug.toggle();
    this.toast({ key: on ? 'hud.collision_on' : 'hud.collision_off' });
  };
  private weapons: WeaponLibrary | null = null;
  /** Character field of view; monsters should use `vision.canSee(...)`. */
  vision: VisionCone | null = null;

  private welcome: WelcomeMessage | null = null;
  /** Infection: every zombie in the room, and whether we are one. */
  private infectedIds = new Set<number>();
  private selfInfected = false;
  private get infection(): boolean { return this.welcome?.mode === 'infection'; }
  /** The infection map's rules (sent with every round state), defaults until the first one. */
  private get infectionRules() { return this.hud.get().infection?.rules ?? INFECTION; }
  private store: ChunkStore | null = null;
  private local: LocalPlayer | null = null;
  private localAvatar: Avatar | null = null;
  private sky: SkySystem | null = null;
  private props: PropRenderer | null = null;
  private campLights: CampLights | null = null;
  private guardFlashlights: GuardFlashlights | null = null;
  private readonly guardPoses: FlashlightPose[] = [];
  private vegetation: VegetationRenderer | null = null;
  private minimap: Minimap | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private ocean: Mesh | null = null;
  private waterMaterial: ShaderMaterial | null = null;
  private oceanMaterial: ShaderMaterial | null = null;

  private raf = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private elapsed = 0;
  private lastHud = 0;
  private lastPing = 0;
  private lastMinimap = 0;
  private frames = 0;
  private fps = 0;
  private timeOfDay = 0.3;
  private todAt = 0;
  private deadSince = 0;
  private disposed = false;
  private chatOpen = false;
  private tutorialBlocked = false;
  /** Persisted view mode; the two close cameras share mouse-look controls. */
  private cameraMode: CameraMode = 'top-down';
  private zombieOutline: ZombieOutline | null = null;
  private readonly outlinedZombies: Object3D[] = [];
  private readonly whiteOutlines = new Set<Object3D>();
  /** Survivors sniffed out by our infected: filled red through walls. */
  private readonly xrayOutlines = new Set<Object3D>();
  /** Told the server the map is loaded (it then puts us into matchmaking). */
  private sentReady = false;
  /** Who killed us last (solo battle royale spectating). */
  private killerId: number | null = null;
  private readonly targetVisibility = new TargetVisibility();
  private readonly deathCrates = new Map<string, { id: string; x: number; y: number; z: number }>();
  private lootCrateRenderer: BaseLifeRenderer | null = null;
  private get firstPerson(): boolean { return this.cameraMode === 'first-person'; }
  /** Scoped through an optic whose `lens` shows the magnified picture (no overlay, gun stays up). */
  /**
   * Seeing through the held gun's eyes: first person, or the shoulder camera while scoped (it moves
   * to the eye and shows the same lens sight as first person).
   */
  /**
   * Seen from the eye: first person, and the shoulder camera while aiming a gun (down its sights
   * or optic, the same first-person sight picture as in the Studio).
   */
  private get eyeView(): boolean { return this.firstPerson || (this.cameraMode === 'third-person' && (this.scoped || (this.aiming && !this.shoulderSights))); }
  /**
   * Third person aiming a gun with no optic on it: the camera comes in to the shoulder at head
   * height and the character stays in view (an optic still takes the view to the eye).
   */
  private get shoulderSights(): boolean { return this.cameraMode === 'third-person' && this.aiming && !this.scoped && !this.currentOptic(); }
  private lensScopeReady(): boolean { return (this.firstPerson || this.cameraMode === 'third-person') && !!this.viewModel?.lens; }
  private get lensScoped(): boolean { return this.scoped && this.eyeView && !!this.viewModel?.lens; }
  /** Sight picture drawn on the optic's lens: magnified optics while scoped, red dots / holos once raised to the eye. */
  private get lensSight(): boolean {
    if (this.lensScoped) return true;
    const reticle = this.currentOptic()?.reticle;
    return (reticle === 'dot' || reticle === 'holo') && this.aiming && this.firstPerson && !!this.viewModel?.lens && this.viewModel.aimed > .82;
  }
  private scopeLens: ScopeLens | null = null;
  private readonly aimSway = new AimSway();
  private get mouseLook(): boolean { return this.cameraMode !== 'top-down'; }
  private readonly thirdPersonCamera = new ThirdPersonCamera();
  /** Eased lean of the local view (−1 left … 1 right) and the leaned eye point. */
  private leanBlend = 0;
  /** Stun grenade white-out: full until `until`, then fading over `fade` ms. */
  private readonly flash = { until: 0, fade: 1, peak: 0 };
  private flashOverlay: HTMLDivElement | null = null;
  private flashLevel(): number {
    const now = performance.now(), f = this.flash;
    if (now <= f.until) return f.peak;
    return f.peak * Math.max(0, 1 - (now - f.until) / f.fade) ** 1.6;
  }
  private updateFlash(): void {
    const level = this.flashLevel();
    if (level <= 0.002 && !this.flashOverlay) return;
    if (!this.flashOverlay && typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;z-index:900;opacity:0';
      document.body.appendChild(el); this.flashOverlay = el;
    }
    if (this.flashOverlay) this.flashOverlay.style.opacity = level.toFixed(3);
    if (level <= 0.002) { this.flashOverlay?.remove(); this.flashOverlay = null; this.flash.peak = 0; }
  }
  /** Riding in a passenger seat (free look and shooting; the driver steers). */
  private passenger = false;
  private readonly leanFocus = new Vector3();
  private readonly vehicleCamera = new ThirdPersonCamera();
  private shoulderAim = { yaw: 0, pitch: 0 };
  private get shotYaw(): number { return this.mouseLook ? this.shoulderAim.yaw : this.input.yaw; }
  private get shotPitch(): number { return this.mouseLook ? this.shoulderAim.pitch : this.input.pitch; }
  private viewModel: ViewModel | null = null;
  private readonly pendingLocalShots: Array<() => void> = [];
  /** Sample the bore after this frame's arms, weapon and camera have all been posed. */
  private readonly pendingWeaponInputs: InputMessage[] = [];
  private readonly recoil = new GunRecoil();
  private battleZone: BattleZone | null = null;
  private battleFlight: BattleFlightRenderer | null = null;
  private powerCables: PowerCables | null = null;
  /** When the in-game loading phase began (0 = not loading). */
  private loadingSince = 0;
  private planeReceivedAt = 0;
  private flightCamera = false;
  private recoilWeapon: number | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly hud: HudStore,
    private readonly inventory: InventoryStore,
    private readonly worldMap = new WorldMapStore(),
    mode: GameMode = 'survival',
  ) {
    this.weaponCtl = new WeaponController({
      // Infection: unlimited ammunition (the magazine still needs reloading).
      available: (w) => this.infection ? Infinity : this.inventory.ammoFor(ITEM_BY_WEAPON[w] ?? ''),
      // Rounds actually move on the server (it answers with the new inventory).
      take: (w, n) => this.infection ? n : Math.min(n, this.inventory.ammoFor(ITEM_BY_WEAPON[w] ?? '')),
    });
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.profiler = new FrameProfiler(this.renderer.getContext() as WebGL2RenderingContext);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = settingsStore.get().brightness;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Flashlight pool, created up front: adding lights later would recompile every shader (a
    // hitch each time one switches on). Ours (#0) casts shadows so its beam stops at walls.
    for (let i = 0; i < 4; i++) {
      const t = new SpotLight(0xfff1d6, 0, 26, 0.42, 0.45, 1.6);
      t.castShadow = i === 0;
      if (i === 0) {
        t.shadow.mapSize.set(512, 512);
        t.shadow.camera.near = 0.3;
        t.shadow.bias = -0.002;
      }
      this.scene.add(t, t.target);
      this.torches.push(t);
    }
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.terrainGroup);

    this.input = new InputController(this.renderer.domElement, {
      openChat: () => this.hud.set({ toast: null }),
      activeChange: (active) => {
        this.hud.set({ pointerLocked: active });
        if (active) this.sounds?.unlock();
      },
      openInventory: (key) => this.openBag(key),
      secondary: () => this.useHovered(),
      attachments: () => this.openAttachments(),
      nightVision: () => this.toggleNightVision(),
      vehicle: () => this.onKeyF(),
      hotbar: (slot) => this.inventory.selectSlot(slot),
      // Through a night-vision scope the wheel switches night vision instead of weapons.
      cycleHotbar: (dir) => { if (!this.toggleNightVision()) this.inventory.cycle(dir); },
      scoreboard: (open) => this.hud.set({ scoreboard: open }),
      skill: () => {
        // Infected: sniff out every survivor within 10 m for 6 s, seen through walls (only by us).
        const now = performance.now();
        if (!this.selfInfected || now < this.hud.get().sniffReadyAt) return;
        this.hud.set({ sniffUntil: now + SNIFF.ms, sniffReadyAt: now + SNIFF.cooldownMs });
      },
      reload: () => this.weaponCtl.reload(performance.now(), this.equippedWeapon()),
      heal: () => void this.useMedkit(),
      primary: () => this.building?.primary() ?? false,
      wheel: (dir) => this.building?.wheel(dir) ?? false,
      escape: () => {
        if (this.building?.cancelPlanning()) return true;
        if (!this.hud.get().dialogue) return false;
        this.closeDialogue();
        return true;
      },
    });
    this.inventory.send = (msg) => this.conn.sendInv(msg);
    this.inventory.onBuy = (item) => this.buy(item);
    this.inventory.onUseMedkit = (uid) => this.useMedkit(uid);
    // Equip sound: a different item taken in hand, or something put in a weapon / armour slot.
    let prev = new Map<number, string>();
    let prevEquipped: number | null = null;
    this.subscriptions.push(this.inventory.subscribe(() => {
      const st = this.inventory.get();
      const now = new Map(st.items.map((i) => [i.uid, i.container as string]));
      const slot = (c: string | undefined) => !!c && (c.startsWith('armor_') || c === 'heavy' || c === 'primary' || c === 'pack_rifle' || c === 'pack' || c === 'secondary' || c === 'grenades');
      if (prev.size) {
        const moved = st.items.some((i) => slot(i.container) && prev.has(i.uid) && !slot(prev.get(i.uid)));
        if (moved || (st.equipped !== prevEquipped && st.equipped !== null && prev.has(st.equipped))) this.sounds?.play('equip', { volume: 0.55 });
      }
      prev = now;
      prevEquipped = st.equipped;
    }));
    this.inventory.onUseCoal = (uid) => {
      const item = this.inventory.get().items.find(i => i.uid === uid);
      if (item?.itemId !== 'coal_carton') return false;
      const camp = this.welcome?.world.camp, local = this.local;
      // Mirrors the server: no open fires inside the main base (its pad reaches 4 m past the walls).
      if (camp && local && Math.max(Math.abs(local.state.x - camp.x), Math.abs(local.state.z - camp.z)) <= camp.halfSize + 6) {
        this.toast({ key: 'toast.no_fire_in_camp' });
        return true;
      }
      this.lifeAction('ignite', 'coal_carton', undefined, uid);
      return true;
    };
    this.inventory.onUseItem = (uid) => this.building?.useItem(uid) ?? false;
    this.inventory.onDeposit = (bp, item) => this.building?.deposit(bp, item);
    this.inventory.onClaim = (bp) => this.building?.claim(bp);
    this.inventory.onOrder = (entry) => this.building?.order(entry);
    this.inventory.onEat = (uid) => {
      const item = this.inventory.get().items.find((i) => i.uid === uid);
      if (!item || !this.hud.get().life?.config.foods?.some((f) => f.item === item.itemId)) return false;
      this.lifeAction('eat', item.itemId, undefined, uid);
      this.sounds?.play('eat', { volume: 0.8 });
      return true;
    };
    this.inventory.onNurseHeal = () => this.nurseHeal();
    this.inventory.onDevCoins = () => this.conn.sendDevCoins();
    this.inventory.onSell = (uid) => this.sell(uid);
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(container);
    this.onResize();

    this.conn = new GameConnection({
      onWelcome: (m) => { if (!this.disposed) this.onWelcome(m); },
      onSnapshot: (s) => { if (!this.disposed) this.onSnapshot(s); },
      onChunk: (c) => { if (!this.disposed) this.store?.set(this.building ? this.building.filterChunk(c) : c); },
      onUnload: (list) => { if (!this.disposed) list.forEach(([cx, cz]) => this.store?.remove(cx, cz)); },
      onMessage: (m) => { if (!this.disposed) this.onMessage(m); },
      onClose: (info) => {
        if (this.disposed) return;
        // Match modes: a dropped connection (not a refusal from the server) rejoins the same match
        // by itself; the server holds the place for a couple of minutes.
        const hud = this.hud.get(), arena = mode === 'battle-royale' || mode === 'infection' || mode === 'waves';
        const over = hud.battle?.phase === 'finished' || !!hud.infection?.over || hud.waves?.phase === 'over' || (mode === 'battle-royale' && !!this.local?.dead);
        if (arena && !info.message && !over) {
          const attempt = rejoinAttempt();
          if (attempt <= 8) {
            this.hud.set({ status: 'connecting', statusDetail: { key: 'raw', vars: { text: `Mất kết nối · đang vào lại trận (lần ${attempt})…` } } });
            window.setTimeout(() => { if (!this.disposed) window.location.reload(); }, Math.min(8000, 1200 * attempt));
            return;
          }
        }
        if (arena && over) clearActiveMatch();
        this.hud.set({
          status: 'disconnected',
          statusDetail: info.message
            ? { key: 'raw', vars: { text: info.message } }
            : info.code === 1006
              ? { key: 'status.connection_lost' }
              : { key: 'status.disconnected_code', vars: { code: info.code, reason: info.reason } },
        });
        this.input.release();
      },
    }, mode);
  }

  /* ------------------------------------- lifecycle --------------------------------------- */

  /** This player's look on every model of them: the body, the first-person hands, the inventory. */
  private applyOwnLook(look: Appearance): void {
    this.look = look;
    this.localAvatar?.setAppearance(look);
    this.viewModel?.setLook(look);
    this.preview?.setAppearance(look);
  }

  private async loadOwnedCharacter(url?: string, progress?: (p: number) => void): Promise<CharacterTemplate> {
    const template = url && ZOMBIE_MODEL_URLS.includes(url) ? await loadZombieModel(url) : await loadPlayerCharacter(url, progress);
    if (this.disposed) { this.resources.object(template.root); throw new Error('engine disposed'); }
    this.ownedModels.add(template.root);
    return template;
  }

  async start(): Promise<void> {
    // Canvas nameplates must wait for the same Vietnamese font as the HTML HUD.
    // A failed font request can still use the system fallback without blocking the game.
    await document.fonts.load('600 26px "Noto Sans"', 'Tiếng Việt: ô â ă ê ơ ư đ ấ ộ ắ ễ ự').catch(() => undefined);
    // The character must be fully downloaded and built before the world is entered, so nothing
    // heavy is parsed or uploaded while playing.
    this.hud.set({ status: 'loading', statusDetail: { key: 'status.loading_character' }, loadProgress: 0 });
    try {
      this.character = await this.loadOwnedCharacter(undefined, (p) => { if (!this.disposed) this.hud.set({ loadProgress: p * 0.6 }); });
      this.look = cachedLook() ?? DEFAULT_APPEARANCE;
      void loadLook().then((look) => { if (look && !this.disposed) this.applyOwnLook(look); }).catch(() => { /* keep the cached look */ });
      for (const url of ['/models/mobs/suffolk-sheep.bbmodel', '/models/mobs/tamed-wild-boar.bbmodel']) {
        const template = await this.loadOwnedCharacter(url);
        const attack = template.clips.get('snout_nudge');
        if (attack) template.clips.set('melee_attack', attack);
        this.animalTemplates.push(template);
        this.animalByModel.set(url, template);
      }
      for (const url of NPC_MODELS) {
        const t = await this.loadOwnedCharacter(url);
        // Give armless-hand rigs (soldiers) hands so they can hold their weapon.
        let ready = t;
        try { if (!t.root.getObjectByName('hand_right')) ready = prepareGuardModel(t, this.character); } catch { ready = t; }
        this.questTemplates.set(url, ready);
      }
      this.merchantTemplate = prepareGuardModel(await this.loadOwnedCharacter(MERCHANT_MODEL_URL), this.character);
      this.nurseTemplate = prepareGuardModel(await this.loadOwnedCharacter(NURSE_MODEL_URL), this.character);
      try { this.architectTemplate = prepareGuardModel(await this.loadOwnedCharacter(ARCHITECT_MODEL_URL), this.character); } catch (err) { console.error('architect model failed', err); }
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_weapons' } });
      this.weapons = await loadWeapons(this.character, (p) => this.hud.set({ loadProgress: 0.6 + p * 0.25 }));
      for (const weapon of this.weapons.values()) {
        if (this.disposed) { this.resources.object(weapon.object); this.resources.object(weapon.display); }
        else { this.ownedModels.add(weapon.object); this.ownedModels.add(weapon.display); }
      }
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_zombies' } });
      // Ordinary zombies' walk / run / scream clips, retargeted onto each skin as it spawns.
      [this.zombieTemplates] = await Promise.all([Promise.all(ZOMBIE_MODEL_URLS.map(url => this.loadOwnedCharacter(url))), loadZombieClips()]);
      this.zombieTemplate = this.zombieTemplates[0]!;
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_sounds' } });
      // Loudness is judged from the character's head, not the high camera.
      this.sounds = new SoundBank(() => {
        const s = this.local?.state;
        return s ? this.listenerPos.set(s.x, s.y + 1.6, s.z) : this.camera.position;
      }, () => (this.mouseLook ? this.input.yaw : CAM_YAW));
      await this.sounds.load((p) => this.hud.set({ loadProgress: 0.85 + p * 0.15 }));
      if (this.disposed) return;
      // Reload sounds and hands follow each gun's reload script (reload-scripts.ts).
      this.weaponCtl.onReload = (weapon, ms) => this.onReload(weapon, ms);
      this.weaponCtl.onReloadCancel = () => { this.stopReloadSounds(); this.viewModel?.stopReload(); this.localAvatar?.stopReload(); };
      this.weaponCtl.onEmpty = (weapon) => this.onOutOfAmmo(weapon);
      this.hud.set({ statusDetail: { key: 'status.preparing' }, loadProgress: 1 });
      const preview = new Avatar(this.character, true);
      for (const id of this.weapons.keys()) preview.setWeapon(id, this.weapons);
      if (itemIcons.size === 0) renderItemIcons(this.weapons);
      this.preview = new CharacterPreview(this.character);
      this.preview.setAppearance(this.look);
      this.inventory.preview = this.preview;
      this.subscriptions.push(this.inventory.subscribe(() => { this.syncArmor(); this.syncPreview(); }));
      this.syncPreview();
      const zombiePreview = new ZombieAvatar(this.zombieTemplate, () => undefined);
      zombiePreview.root.visible = true;
      zombiePreview.addTo(this.scene);
      preview.addTo(this.scene);
      try { await this.renderer.compileAsync(this.scene, this.camera); }
      finally { preview.dispose(this.scene); zombiePreview.dispose(this.scene); }
    } catch (err) {
      if (this.disposed) return;
      this.hud.set({ status: 'disconnected', statusDetail: { key: 'status.assets_failed', vars: { error: (err as Error).message } } });
      return;
    }
    if (this.disposed) return;
    this.hud.set({ status: 'connecting', statusDetail: { key: 'status.authenticating' }, loadProgress: 0 });
    try {
      await this.conn.connect();
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.joining' } });
    } catch (err) {
      if (this.disposed) return;
      this.hud.set({ status: 'disconnected', statusDetail: { key: 'raw', vars: { text: (err as Error).message } } });
      return;
    }
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.flashOverlay?.remove(); this.flashOverlay = null;
    window.removeEventListener('keydown', this.onDebugKey);
    this.colliderDebug?.dispose(); this.colliderDebug = null;
    this.vehicles?.dispose();
    this.battleZone?.dispose();
    this.battleFlight?.dispose();
    this.powerCables?.dispose(); this.powerCables = null;
    this.squadMarkers.dispose();
    this.zombieOutline?.dispose();
    this.shaderPack?.dispose();
    this.shaderPack = null;
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.bubbles) b.el.remove();
    this.lifeRenderer?.dispose();
    this.privateQuestRenderer?.dispose();
    this.lootCrateRenderer?.dispose();
    settingsStore.setGameMode('survival');
    cancelAnimationFrame(this.raf);
    this.conn.close();
    this.input.dispose();
    this.resize.disconnect();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.inventory.send = this.inventory.onBuy = this.inventory.onSell = this.inventory.onUseMedkit = null;
    this.inventory.onUseCoal = this.inventory.onEat = this.inventory.onNurseHeal = this.inventory.onDevCoins = null;
    this.inventory.preview = null;
    this.preview?.dispose();
    this.localAvatar?.dispose(this.scene);
    for (const remote of this.remotes.values()) remote.avatar.dispose(this.scene);
    for (const zombie of this.zombies.values()) zombie.avatar.dispose(this.scene);
    this.remotes.clear();
    this.zombies.clear();
    this.vision?.dispose();
    this.viewModel?.dispose();
    this.scopeLens?.dispose();
    this.throwArc?.dispose();
    this.throwArc = null;
    this.scopeLens = null;
    this.debris?.dispose();
    this.effects?.dispose();
    this.sounds?.dispose();
    this.props?.dispose();
    this.building?.dispose();
    this.building = null;
    this.campLights?.dispose();
    this.guardFlashlights?.dispose();
    this.groundItems?.dispose();
    this.slashes?.dispose();
    this.worldMap.dispose();
    this.vegetation?.dispose();
    this.sky?.dispose();
    for (const m of this.meshes.values()) this.disposeChunkMeshes(m);
    this.meshes.clear();
    this.buildQueue.clear();
    this.store?.clear();
    this.store = null;
    this.library.dispose();
    for (const root of this.ownedModels) this.resources.object(root);
    this.ownedModels.clear();
    this.resources.release(this.terrainMaterial);
    this.groundTextures.dispose();
    this.shockwaves.dispose();
    this.resources.release(this.coinRingGeometry);
    this.resources.release(this.coinRingMaterial);
    if (this.waterMaterial) this.resources.release(this.waterMaterial);
    if (this.oceanMaterial) this.resources.release(this.oceanMaterial);
    if (this.ocean) this.resources.object(this.ocean);
    if (this.laser) this.resources.object(this.laser);
    if (this.throwMarker) this.resources.object(this.throwMarker);
    for (const torch of this.torches) torch.dispose();
    this.coinDrops.clear();
    this.pendingLocalShots.length = 0;
    this.pendingWeaponInputs.length = 0;
    this.scene.clear();
    window.clearTimeout(this.contextTimer);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  private nearBlur: NearBlur | null = null;
  /** How much the things right in front of the eye are blurred: first person only, less while aiming down the sights (the eye on the sights), none through a scope. */
  private nearBlurStrength(): number {
    if (!settingsStore.get().nearBlur || !this.eyeView || this.scoped || !this.viewModel) return 0;
    return 1 - .7 * this.viewModel.aimed;
  }

  private lastMoss = 0;
  /** Moss on the rocks follows the local climate: thick where it is green and damp, none in desert or snow. */
  private updateRockMoss(chunks: ReadonlyMap<number, ChunkData>, x: number, z: number, now: number): void {
    if (now - this.lastMoss < 500) return;
    this.lastMoss = now;
    const cx = Math.floor(x / MOSS_CHUNK), cz = Math.floor(z / MOSS_CHUNK), chunk = chunks.get(mossChunkKey(cx, cz));
    if (!chunk) return;
    const step = lodStep(chunk.lod), n = chunk.verts;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - cx * MOSS_CHUNK) / step))), j = Math.min(n - 1, Math.max(0, Math.round((z - cz * MOSS_CHUNK) / step)));
    const hum = chunk.humidity[j * n + i]! / 255, temp = chunk.temperature[j * n + i]! / 255;
    const want = Math.max(0, Math.min(1, (hum - .4) / .35)) * Math.max(0, Math.min(1, (temp - .12) / .15)) * Math.max(0, Math.min(1, (.88 - temp) / .12));
    ROCK_MOSS.value += (want - ROCK_MOSS.value) * .3;
  }

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
    this.minimap = canvas && this.welcome ? new Minimap(canvas, this.welcome.world.seaLevel, this.registry, this.library) : null;
    if (this.minimap) this.minimap.showPlayer = false;
    this.minimapTurn = NaN;
  }

  /** The compass strip across the top of the view. */
  attachCompass(canvas: HTMLCanvasElement | null): void { this.compass = canvas ? new Compass(canvas) : null; }
  private compass: Compass | null = null;
  private minimapTurn = NaN;
  private lastCompass = 0;

  /**
   * Every frame: the minimap turns with the view (it is drawn a few times a second, turned here
   * smoothly, the player's arrow fixed pointing up over it), and the compass follows the heading.
   */
  private updateHeadingHud(now: number, px: number, pz: number): void {
    const yaw = this.input.yaw;
    if (this.minimapCanvas) {
      const turn = yaw - CAM_YAW;
      if (!(Math.abs(turn - this.minimapTurn) < 1e-4)) { this.minimapTurn = turn; this.minimapCanvas.style.transform = `rotate(${turn}rad)`; }
    }
    if (this.compass && now - this.lastCompass > 16) {
      this.lastCompass = now;
      const marks: CompassMark[] = this.worldMap.get().locations.filter((l) => l.guide || !l.fixed || l.quest).map((l) => ({ x: l.x, z: l.z, color: l.quest ? '#ffb000' : l.fixed ? '#ffd96b' : '#4fc3ff' }));
      for (const m of this.hud.get().team?.members ?? []) if (m.entityId !== this.welcome?.playerId && m.inGame && m.x !== undefined && m.z !== undefined) marks.push({ x: m.x, z: m.z, color: '#7ce38b' });
      this.compass.draw(yaw, px, pz, marks);
    }
  }

  setTutorialBlocked(blocked: boolean): void {
    this.tutorialBlocked = blocked;
    this.input.suspended = blocked || this.chatOpen || this.inventory.get().open || this.hud.get().mapOpen;
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open;
    this.input.suspended = open || this.tutorialBlocked || this.inventory.get().open || this.hud.get().mapOpen;
  }

  setInventoryOpen(open: boolean): void {
    this.input.suspended = open || this.tutorialBlocked || this.chatOpen || this.hud.get().mapOpen;
  }

  tutorial(message: Extract<ClientMessage, { t: 'tutorial' }>): void { this.conn.sendTutorial(message); }

  setMapOpen(open: boolean): void {
    // Opening the atlas must use this frame's heading, not the throttled HUD sample.
    const state = this.local?.state;
    this.hud.set({ mapOpen: open, ...(open ? {
      viewYaw: this.input.yaw,
      ...(state ? { position: [state.x, state.y, state.z] as [number, number, number] } : {}),
    } : {}) });
    this.input.suspended = open || this.tutorialBlocked || this.chatOpen || this.inventory.get().open;
  }

  useVehicle(): void {
    if (!this.local || this.local.dead || this.local.state.flight) return;
    const p = this.local.state;
    const v = this.vehicles?.rider(this.welcome!.playerId) ?? this.vehicles?.nearest(p.x, p.y, p.z);
    if (v) this.conn.sendVehicle(v.id);
  }

  lifeAction(op: 'plant' | 'harvest' | 'cook' | 'buy' | 'sell' | 'eat' | 'loot' | 'ignite', target: string, choice?: string, uid?: number): void {
    if (op === 'buy' || op === 'sell') markPending(`trade:${target}:${op}`);
    if (op === 'plant') markPending('plant');
    this.conn.sendLife(op, target, choice, uid);
  }

  quest(op: 'accept' | 'cancel' | 'turnin' | 'retrieve', npc: string, quest: string, index?: number): void {
    markPending(`quest:${quest}`);
    this.conn.sendQuest(op, npc, quest, index);
  }

  sendChat(text: string, channel: 'world' | 'team' = 'world'): void {
    const t = text.trim();
    if (t) this.conn.sendChat(t, channel);
  }

  requestRespawn(): void {
    this.conn.sendRespawn();
  }

  private readonly stepKeys = new Map<number, { x: number; z: number; speed: number }>();
  private readonly localStepKey = {};

  /**
   * Footsteps of every walking player (us included), positional so everyone nearby hears them:
   * a steady pace when walking, a quicker one when running.
   */
  private updateFootsteps(dt: number): void {
    const sounds = this.sounds;
    if (!sounds) return;
    const step = (key: object, x: number, y: number, z: number, speed: number, flags: number, dead: boolean) => {
      const grounded = (flags & EntityFlags.Grounded) !== 0 && (flags & (EntityFlags.Swimming | EntityFlags.Rolling)) === 0;
      if (dead || !grounded || speed < 0.6) { sounds.stopLoop(key); return; }
      const running = (flags & EntityFlags.Sprinting) !== 0 || speed > 5;
      // Cadence follows the actual ground speed (walk 3.4 m/s = the recording's own pace).
      sounds.loopAt(key, 'footsteps', { at: { x, y, z }, volume: running ? 0.3 : 0.2, rate: Math.max(0.55, Math.min(2.2, speed / 3.4)), refDistance: 2, maxDistance: 28 });
    };
    const l = this.local;
    if (l) {
      const s = l.state;
      const flags = (s.grounded ? EntityFlags.Grounded : 0) | (s.swimming ? EntityFlags.Swimming : 0) | (s.rollTicks > 0 ? EntityFlags.Rolling : 0) | (l.lastButtons & Buttons.Sprint ? EntityFlags.Sprinting : 0);
      if (l.riding) sounds.stopLoop(this.localStepKey);
      else step(this.localStepKey, s.x, s.y, s.z, Math.hypot(s.vx, s.vz), flags, l.dead);
    }
    const seen = new Set<number>();
    for (const [id, r] of this.remotes) {
      if (r.entity.kind !== EntityKind.Player) continue;
      seen.add(id);
      const p = r.avatar.root.position;
      const last = this.stepKeys.get(id) ?? { x: p.x, z: p.z, speed: 0 };
      if (this.vehicles?.rider(id)) {
        sounds.stopLoop(last);
        last.x = p.x; last.z = p.z; last.speed = 0;
        this.stepKeys.set(id, last);
        continue;
      }
      // Smoothed speed from the rendered (interpolated) position.
      const v = Math.hypot(p.x - last.x, p.z - last.z) / Math.max(dt, 1e-3);
      last.speed += (v - last.speed) * Math.min(1, dt * 8);
      last.x = p.x;
      last.z = p.z;
      this.stepKeys.set(id, last);
      step(last, p.x, p.y, p.z, last.speed, r.entity.pose.flags, (r.entity.pose.flags & EntityFlags.Dead) !== 0);
    }
    for (const [id, key] of this.stepKeys) if (!seen.has(id)) { sounds.stopLoop(key); this.stepKeys.delete(id); }
  }

  private readonly torches: SpotLight[] = [];

  /**
   * Flashlights in the off hand switch on by themselves at night: a cone ahead of each carrier
   * (us first, then the nearest other players; a small fixed pool of lights).
   */
  private readonly torchOrigin = new Vector3();
  private readonly torchDirection = new Vector3();
  private readonly torchLook = new Vector3();

  private updateFlashlights(): void {
    type Carrier = { x: number; y: number; z: number; model: { offhandLightPose(origin: Vector3, direction: Vector3): boolean; aimOffhand(look: Vector3): void } };
    const local = this.local;
    const mine: Carrier | null = local && !local.dead && this.inventory.get().items.some(i => i.container === 'offhand' && i.itemId === 'flashlight')
      ? { x: local.state.x, y: local.state.y, z: local.state.z, model: (this.firstPerson ? this.viewModel : this.localAvatar)! }
      : null;
    const others: Carrier[] = [...this.remotes.values()]
      .filter(r => r.entity.kind === EntityKind.Player && (r.entity.pose.flags & EntityFlags.Flashlight) && !(r.entity.pose.flags & EntityFlags.Dead))
      .map(r => ({ x: r.avatar.root.position.x, y: r.avatar.root.position.y, z: r.avatar.root.position.z, model: r.avatar }))
      .sort((a, b) => Math.hypot(a.x - (local?.state.x ?? 0), a.z - (local?.state.z ?? 0)) - Math.hypot(b.x - (local?.state.x ?? 0), b.z - (local?.state.z ?? 0)))
      .slice(0, 3);
    // Held lights point where their carrier looks, not wherever the hand animation swings them.
    if (mine) mine.model.aimOffhand(lookDirection(this.shotYaw, this.shotPitch, this.torchLook));
    for (const r of this.remotes.values()) {
      if (r.entity.kind === EntityKind.Player && r.entity.pose.flags & EntityFlags.Flashlight) r.avatar.aimOffhand(lookDirection(r.entity.pose.yaw, r.entity.pose.pitch, this.torchLook));
    }
    const slots = [mine, ...others];
    this.torches.forEach((light, index) => {
      const carrier = slots[index];
      const dark = carrier ? this.darkness(carrier.x, carrier.y, carrier.z) : 0;
      if (!carrier?.model || dark < .45 || !carrier.model.offhandLightPose(this.torchOrigin, this.torchDirection)) {
        light.intensity = 0; return;
      }
      const origin = this.torchOrigin, direction = this.torchDirection;
      light.position.copy(origin);
      light.target.position.copy(origin).addScaledVector(direction, 12);
      light.target.updateMatrixWorld(true);
      const hit = this.store?.collision.raycast(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, 26, Mask.LineOfSight, this.torchHit);
      light.distance = hit ? Math.max(.1, this.torchHit.t + .08) : 26;
      light.intensity = 60 * Math.min(1, (dark - .45) / .3 + .35);
    });
  }

  private readonly torchHit = makeRayHit();
  private readonly roofHit = makeRayHit();

  /**
   * How dark a spot is, 0 (bright daylight) … 1 (pitch black): night time, a roof overhead
   * (inside a building) and nearby lit lamp posts / campfires all count.
   */
  private darkness(x: number, y: number, z: number): number {
    const night = this.sky?.night ?? 0;
    const roofed = !!this.store?.collision.raycast(x, y + 1.7, z, 0, 1, 0, 12, Mask.LineOfSight, this.roofHit);
    let light = (1 - night) * (roofed ? 0.3 : 1);
    if (night > 0.2) {
      for (const lamp of this.campLights?.lamps ?? []) {
        const d = Math.hypot(lamp.x - x, lamp.z - z);
        if (d < 10) light += (1 - d / 10) * 0.9 * night;
      }
      if (this.fireLights.some(l => l.intensity > 0 && l.position.distanceTo(this.tmpC.set(x, y, z)) < 6)) light += 0.5 * night;
    }
    return Math.max(0, Math.min(1, 1 - light));
  }

  private readonly lastHits = new Map<number, { kx: number; kz: number; force: number }>();
  /** Help calls from downed players nearby. */
  private readonly distress = new Map<number, { name: string; x: number; z: number; until: number }>();

  /** A speaker over each teammate talking on team voice (matched by player name). */
  private showTalking(): void {
    const talking = voice.speakingNames();
    for (const [id, r] of this.remotes) {
      if (r.entity.kind !== EntityKind.Player) continue;
      const name = this.names.get(id);
      r.avatar.setSpeaking(!!name && talking.has(name));
    }
  }

  /** A downed player within reviving reach, if any. */
  private downedNear(): { id: number } | null {
    const s = this.local?.state;
    if (!s) return null;
    for (const [id, r] of this.remotes) {
      if (r.entity.kind !== EntityKind.Player || !(r.entity.pose.flags & EntityFlags.Downed)) continue;
      // Battle royale: only squadmates can be revived.
      if (this.welcome?.mode === 'battle-royale' && !this.hud.get().team?.members.some((m) => m.entityId === id)) continue;
      const p = r.avatar.root.position;
      if (Math.hypot(p.x - s.x, p.z - s.z) <= 2.4) return { id };
    }
    return null;
  }

  callForHelp(): void {
    this.conn.sendDistress();
  }

  giveUp(): void {
    this.conn.sendGiveUp();
  }

  private readonly fireLights: PointLight[] = [];
  private lastDropFix = 0;

  /** Burning campfires (cooking stations): flames + a flickering warm light on the nearest one. */
  private updateCampfires(px: number, pz: number, now: number): void {
    const life = this.hud.get().life;
    if (!life || !this.effects) return;
    const fires: Array<{ x: number; y: number; z: number; distance: number }> = [];
    for (const o of life.objects) {
      if (!(o.cooking || life.config.stations.some(s => s.id === o.id)) || (o.expiresAt && o.expiresAt <= Date.now())) continue;
      const d = (o.x - px) ** 2 + (o.z - pz) ** 2;
      if (d > 45 * 45) continue;
      ParticleFX.campfire(this.effects.particles, o.x, o.y, o.z);
      fires.push({ ...o, distance: d });
    }
    fires.sort((a, b) => a.distance - b.distance);
    for (let i = 0; i < 4; i++) {
      let light = this.fireLights[i];
      if (!light) { light = new PointLight(0xff9a40, 0, 12, 2); this.fireLights.push(light); this.scene.add(light); }
      const fire = fires[i];
      if (fire) {
        light.position.set(fire.x, fire.y + 0.8, fire.z);
        light.intensity = 9 + Math.sin(now * .023 + i) * 1.6 + Math.sin(now * .061 + i) * 1.2 + Math.random() * .8;
      } else light.intensity = 0;
    }
  }

  /** Ground height at a point (streamed terrain; 0 before it loads). */
  private groundY(x: number, z: number): number {
    const h = this.store?.collision.terrainHeight(x, z);
    return h !== undefined && Number.isFinite(h) ? h : 0;
  }

  /** Soft click for HUD buttons. */
  uiClick(): void {
    this.sounds?.play('uiClick', { volume: 0.45 });
  }

  closeDialogue(): void {
    this.hud.set({ dialogue: null });
  }

  lockPointer(): void {
    this.input.requestLock();
  }

  touchMove(x: number, z: number): void { this.input.touchMove(x, z); }
  touchButton(button: TouchButton, down: boolean): void { this.input.touchButton(button, down); }
  touchFireDirection(x: number, y: number): void { this.input.touchFireDirection(x, y, CAM_YAW); }
  touchSelectWeapon(slot: number): void {
    if (!this.input.touchEnabled || !this.input.locked || this.input.suspended || this.local?.dead || this.hud.get().downed !== null) return;
    this.input.touchButton('aim', false);
    this.inventory.selectSlot(slot);
  }
  resetTouch(): void { this.input.resetTouch(); }
  touchLook(dx: number, dy: number): { x: number; y: number } {
    this.input.touchLook(dx, dy, !this.mouseLook && this.scoped ? 0.4 : 1);
    return { ...this.input.pointer };
  }

  touchAction(action: TouchAction): void {
    if (!this.input.touchEnabled || !this.input.locked || this.input.suspended || this.local?.dead || this.hud.get().downed !== null) return;
    if (action === 'pause') this.input.release();
    else if (action === 'reload') this.weaponCtl.reload(performance.now(), this.equippedWeapon());
    else if (action === 'interact') { this.input.resetTouch(); this.onInteract(); }
    else if (action === 'inventory') { this.input.resetTouch(); this.inventory.setOpen(true); }
    else if (action === 'heal') void this.useMedkit();
    else if (action === 'prone') this.input.toggleProne();
    else if (action === 'weapon') { this.input.touchButton('aim', false); this.inventory.cycle(1); }
  }

  private onResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /* ------------------------------------- networking -------------------------------------- */

  private onWelcome(m: WelcomeMessage): void {
    this.welcome = m;
    // A Studio-uploaded map model this world is built on: known before its chunks arrive.
    for (const def of (m.world.assets ?? []) as AssetDefinitionInput[]) {
      try { this.registry.registerUploaded(def); } catch (err) { console.error('uploaded asset rejected', err); }
    }
    settingsStore.setGameMode(m.mode ?? 'survival');
    this.hud.set({ mode: m.mode ?? 'survival', battle: null, infection: null, tutorial: null });
    this.infectedIds.clear(); this.selfInfected = false;
    // Infection: the weapons this browser picked last time.
    if (m.mode === 'infection') this.conn.sendLoadout(loadInfectionLoadout());
    if (m.mode === 'battle-royale' || m.mode === 'infection' || m.mode === 'waves') { markActiveMatch(m.mode); rejoinSucceeded(); }
    if (m.mode === 'battle-royale') {
      this.battleZone = new BattleZone(this.scene, (x, z) => this.store?.collision.terrainHeight(x, z) ?? Number.NaN);
      this.battleFlight = new BattleFlightRenderer(this.scene);
      void this.battleFlight.load().catch(err => console.error('Battle models unavailable', err));
    }
    const world = m.world;
    this.worldMap.initialize(world);
    this.worldMap.onJump = (point) => this.conn.sendJumpPoint(point?.x ?? -1, point?.z ?? -1);
    const worldSize = world.sizeChunks * world.chunkSize;
    this.clock.seed(m.serverTime);
    this.store = new ChunkStore(worldSize, world.seaLevel, this.registry);
    this.vehicles = new VehicleRenderer(this.scene, this.library, this.store.collision);
    this.local = new LocalPlayer(this.store.collision, m.spawn.x, m.spawn.y, m.spawn.z);
    this.input.yaw = m.spawn.yaw;
    this.sky?.dispose();
    this.sky = new SkySystem(this.scene, world.cosmeticSeed);
    this.waterMaterial = createWaterMaterial(true);
    this.oceanMaterial = createWaterMaterial(false, getWaterUniforms(this.waterMaterial));
    this.ocean = new Mesh(createOceanGeometry(), this.oceanMaterial);
    this.ocean.renderOrder = 1;
    this.ocean.frustumCulled = false;
    this.scene.add(this.ocean);
    this.campLights = new CampLights(this.scene);
    this.guardFlashlights = new GuardFlashlights(this.scene);
    this.groundItems?.dispose();
    this.groundItems = new GroundItems(this.scene, this.weapons);
    this.building?.dispose();
    this.building = new BuildingController({
      scene: this.scene, library: this.library, store: () => this.store, conn: this.conn, hud: this.hud, inventory: this.inventory,
      debris: () => this.debris, particles: () => this.effects?.particles ?? null,
      play: (name, at, volume = .8) => this.sounds?.play(name, at ? { at: { x: at.x, y: at.y, z: at.z }, volume } : { volume }),
      local: () => { const l = this.local; return l && !l.dead ? { x: l.state.x, y: l.state.y, z: l.state.z, yaw: this.mouseLook ? this.input.yaw : this.shotYaw, grounded: l.state.grounded } : null; },
      username: () => this.hud.get().username,
      toast: (msg) => this.toast(msg),
      equippedItemId: () => this.inventory.equippedItemId(),
      planeSound: (key, at) => { if (at) this.sounds?.loopAt(key, 'transportPlane', { volume: .75, at, maxDistance: 1400, refDistance: 40 }); else this.sounds?.stopLoop(key); },
      serverNow: () => this.clock.now(),
    });
    this.building.setWorld(world);
    this.slashes?.dispose();
    this.slashes = new SlashEffects(this.scene);
    this.props = new PropRenderer(this.scene, this.library, () => this.store!.chunks.values());

    this.vegetation = new VegetationRenderer(this.scene, (cx, cz) => this.store?.get(cx, cz), world.seaLevel, world.cosmeticSeed, world.camp, this.library, (asset) => {
      const def = this.registry.byNumericId(asset);
      return def && def.collisionLayer !== 'none' ? def.bounds.radius : 0;
    });
    if (this.minimapCanvas) { this.minimap = new Minimap(this.minimapCanvas, world.seaLevel, this.registry, this.library); this.minimap.showPlayer = false; }
    this.localAvatar = new Avatar(this.character!, true);
    this.localAvatar.setAppearance(this.look);
    this.localAvatar.ground = (x, z) => this.groundY(x, z);
    this.localAvatar.addTo(this.scene);
    // (Re)send and re-apply the worn armour for this session.
    this.vision ??= new VisionCone(this.scene);
    this.armorKey = '';
    this.syncArmor();
    this.debris ??= new DebrisSystem(this.scene);
    if (!this.colliderDebug) { this.colliderDebug = new ColliderDebug(this.scene); window.addEventListener('keydown', this.onDebugKey); }
    if (!this.effects) {
      this.effects = new CombatEffects(this.scene, this.weapons?.get('grenade')?.display ?? null, this.sounds, () => this.camera.position);
      const rounds = new Map<string, Object3D>();
      for (const kind of ['grenade40', 'rocket', 'bolt', 'c4']) {
        const model = this.weapons?.get(`proj_${kind}`)?.display;
        if (model) rounds.set(kind, model);
      }
      this.effects.setProjectileModels(rounds);
      for (const [item, weapon] of [['flashbang', WeaponId.Flashbang], ['smoke_grenade', WeaponId.SmokeGrenade]] as const) {
        const model = this.weapons?.get(item)?.display;
        if (model) this.effects.grenadeModels.set(weapon, model);
      }
      this.onResize();
    }
    // Preload every registered model so first sight of an asset never stalls.
    for (const def of this.registry.all()) void this.library.load(def.numericId);

    this.store.listen({
      onChunkSet: (chunk, prev) => {
        this.buildQueue.set(chunkKey(chunk.cx, chunk.cz), chunk);
        if (prev) this.minimap?.forget(prev);
        if (chunk.props.length || prev?.props.length) this.props?.markDirty();
        if (chunk.lod === 0) this.vegetation?.invalidate(chunk.cx, chunk.cz);
      },
      onChunkRemoved: (chunk) => {
        const key = chunkKey(chunk.cx, chunk.cz);
        this.buildQueue.delete(key);
        const m = this.meshes.get(key);
        if (m) this.disposeChunkMeshes(m);
        this.meshes.delete(key);
        this.minimap?.forget(chunk);
        if (chunk.props.length) this.props?.markDirty();
        this.vegetation?.invalidate(chunk.cx, chunk.cz);
        this.building?.forget(chunk);
      },
    });
    this.hud.set({ status: 'loading', statusDetail: { key: 'status.streaming' }, username: m.username });
  }

  private snapshotCount = 0;

  private lastMatchMark = 0;
  private onSnapshot(s: Snapshot): void {
    // Keep the "playing a match" mark fresh, so a closed tab comes back here from the menu.
    const mode = this.welcome?.mode;
    if ((mode === 'battle-royale' || mode === 'infection' || mode === 'waves') && performance.now() - this.lastMatchMark > 10_000) {
      this.lastMatchMark = performance.now();
      const hud = this.hud.get();
      if (hud.battle?.phase === 'finished' || hud.infection?.over || hud.waves?.phase === 'over' || (mode === 'battle-royale' && this.local?.dead)) clearActiveMatch(); else markActiveMatch(mode);
    }
    this.snapshotCount++;
    const local = this.local;
    if (!local || !this.welcome) return;
    this.clock.seed(s.serverTime);
    this.timeOfDay = s.timeOfDay;
    this.todAt = performance.now();
    const wasDead = local.dead;
    local.reconcile(s.self, s.ackSeq);
    if (local.dead && !wasDead) this.deadSince = performance.now();

    const seen = new Set<number>();
    for (const e of s.entities) {
      seen.add(e.id);
      if (e.kind === EntityKind.Zombie) {
        let zb = this.zombies.get(e.id);
        if (!zb) {
          zb = { entity: new RemoteEntity(e.id, e.kind), avatar: new ZombieAvatar(this.zombieTemplates[zombieTemplateIndex(zombieVariant(e.weapon), e.id)]!, (x, y, z, n) => this.gore(x, y, z, 0, 0, n), zombieScale(zombieVariant(e.weapon)), zombieVariant(e.weapon), e.id), variant: zombieVariant(e.weapon), limbs: e.weapon & (15 | Limb.Head), voiceAt: performance.now() + Math.random() * 4000, lastGroan: 0, enraged: false, hurtAt: 0, lastHit: null };
          zb.avatar.ground = (x, z) => this.groundY(x, z);
          zb.avatar.root.position.set(e.x, e.y, e.z);
          zb.avatar.root.rotation.y = e.yaw;
          zb.avatar.addTo(this.scene);
          this.zombies.set(e.id, zb);
        }
        zb.entity.push(s.serverTime, e);
        zb.limbs = e.weapon & (15 | Limb.Head);
        if ((e.armor ?? 0) !== zb.armor) { zb.armor = e.armor ?? 0; this.dressZombie(zb.avatar, zb.armor); }
        continue;
      }
      let r = this.remotes.get(e.id);
      if (!r) {
        // Soldiers (camp guards, Colonel Lâm) are survivors like the players: the same realistic
        // body and the same animations, each with its own look, in helmet and plate carrier.
        const outfit = this.soldierOutfit(e.kind, e.id);
        const template = outfit ? this.character! : e.kind === EntityKind.Animal ? (this.animalTemplate(e.id) ?? this.character!) : e.kind === EntityKind.QuestNpc ? (this.questTemplates.get(this.questNpcDefinitions.find((n) => n.id === e.id)?.model ?? '') ?? this.character!) : e.kind === EntityKind.Architect ? (this.architectTemplate ?? this.merchantTemplate!) : e.kind === EntityKind.Merchant ? this.merchantTemplate! : e.kind === EntityKind.Nurse ? this.nurseTemplate! : this.character!;
        r = { entity: new RemoteEntity(e.id, e.kind), avatar: new Avatar(template, false), weapon: 0, ...(outfit ? { outfit } : {}) };
        // Every player and bot has its own body, skin and hair (bots: a look from their id).
        if (e.kind === EntityKind.Player || outfit) r.avatar.setAppearance(this.looks.get(e.id) ?? randomAppearance(e.id));
        r.avatar.ground = (x, z) => this.groundY(x, z);
        // Four-legged: the whole body faces where it goes (no separate head turn).
        if (e.kind === EntityKind.Animal) r.avatar.rigid = true;
        r.avatar.addTo(this.scene);
        r.avatar.setName(this.remoteName(e.id, e.kind), this.ranks.get(e.id), this.pvpNames.has(e.id));
        this.remotes.set(e.id, r);
      }
      r.entity.push(s.serverTime, e);
      r.weapon = e.weapon;
      r.back = e.back ?? 0;
      r.gear = e.gear ?? 0;
      r.pack = e.pack ?? 0;
      r.att = e.att ?? 0;
      if ((e.armor ?? 0) !== r.armor) {
        r.armor = e.armor ?? 0;
        this.dressAvatar(r.avatar, r.armor || !r.outfit ? unpackArmor(r.armor) : r.outfit);
      }
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      r.avatar.dispose(this.scene);
      this.remotes.delete(id);
      this.targetVisibility.forget(id);
    }
    for (const [id, zb] of this.zombies) {
      if (seen.has(id)) continue;
      zb.avatar.dispose(this.scene);
      this.sounds?.stop(zb);
      this.zombies.delete(id);
      this.targetVisibility.forget(id);
    }
  }

  private gore(x: number, y: number, z: number, dx: number, dz: number, amount: number): void {
    if (this.effects) ParticleFX.gore(this.effects.particles, x, y, z, dx, dz, amount);
  }

  /** Blood (and gore for headshots) where a hit landed, sprayed away from the attacker. */
  private bloodAt(m: HitEvent): void {
    if (!this.effects) return;
    const from =
      m.attackerId === this.welcome?.playerId && this.local
        ? this.local.state
        : (this.remotes.get(m.attackerId)?.entity.pose ?? this.zombies.get(m.attackerId)?.entity.pose ?? null);
    let dx = 0;
    let dz = 0;
    if (from) {
      dx = m.x - from.x;
      dz = m.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    // Remembered for the ragdoll if this hit turns out to be fatal.
    this.lastHits.set(m.targetId, { kx: m.kx ?? dx, kz: m.kz ?? dz, force: m.force ?? Math.min(6, 1 + m.damage / 12) });
    if (m.force !== undefined && !isZombieId(m.targetId)) {
      const av = m.targetId === this.welcome?.playerId ? this.localAvatar : this.remotes.get(m.targetId)?.avatar;
      if (av) av.knockHint = { kx: m.kx ?? dx, kz: m.kz ?? dz, force: m.force };
    }
    if (isZombieId(m.targetId)) {
      const zb = this.zombies.get(m.targetId);
      // Heavy blows (strong cuts, hammer blows, heavy rounds) stagger it.
      zb?.avatar.flinchFrom(m.damage >= 45);
      if (zb) zb.lastHit = { x: m.x, y: m.y, z: m.z, zone: m.zone, damage: m.damage, kx: m.kx ?? dx, kz: m.kz ?? dz, force: m.force ?? 2 };
      const now = performance.now();
      if (zb && m.zone !== 'head' && now - zb.hurtAt > 250) {
        zb.hurtAt = now;
        this.sounds?.play('zombieHurt', { at: { x: m.x, y: m.y, z: m.z }, volume: 0.9, maxDistance: 35 });
      }
      if (m.zone === 'head') this.gore(m.x, m.y, m.z, dx, dz, 1.6);
      else ParticleFX.blood(this.effects.particles, m.x, m.y, m.z, dx, dz, Math.min(2, 0.6 + m.damage / 25));
    } else if (this.remotes.get(m.targetId)?.entity.kind === EntityKind.Animal) {
      // Livestock: a big spray, plus a few drops on the ground.
      ParticleFX.blood(this.effects.particles, m.x, m.y, m.z, dx, dz, Math.min(2, 1.1 + m.damage / 30));
      if (m.damage >= 20) this.gore(m.x, m.y, m.z, dx, dz, 0.6);
    } else {
      // Players / NPCs: a clear spray at the wound, bigger for heavy hits (blades, buckshot).
      ParticleFX.blood(this.effects.particles, m.x, m.y, m.z, dx, dz, Math.min(2, 1.1 + m.damage / 25));
      if (m.damage >= 25) this.gore(m.x, m.y, m.z, dx, dz, 0.5);
    }
  }

  /**
   * Zombie vocals: random groans (a different one each time, 1–4 s after the last ends); once
   * below 30% health it roars and keeps roaring while it charges.
   */
  private zombieVoice(
    zb: { voiceAt: number; lastGroan: number; enraged: boolean; dead?: boolean; variant: number; leaping?: boolean },
    pose: { x: number; y: number; z: number; flags: number; health: number },
    dist2: number,
  ): void {
    const sounds = this.sounds;
    if (!sounds) return;
    if (zb.dead || pose.flags & EntityFlags.Dead) {
      if (!zb.dead) sounds.stop(zb);
      zb.dead = true;
      return;
    }
    const leaping = (pose.flags & EntityFlags.Leaping) !== 0 && !(pose.flags & EntityFlags.Grounded);
    const jumpStart = leaping && !zb.leaping;
    zb.leaping = leaping;
    if (dist2 > 45 * 45) return;
    const now = performance.now();
    const at = { x: pose.x, y: pose.y + 1.4, z: pose.z };
    if (zb.variant === ZombieVariant.Crimson) {
      if (jumpStart) sounds.play('zombieJump', { at, volume: 1.1, maxDistance: 45, channel: zb });
      if (now >= zb.voiceAt && !jumpStart) {
        const pick = Math.random() < .5 ? 'zombieRoar' : 'zombieRoar2';
        const duration = sounds.play(pick, { at, volume: .9, maxDistance: 40, channel: zb });
        zb.voiceAt = now + duration * 1000 + 2000 + Math.random() * 3000;
      }
      return;
    }
    const enraged = pose.health > 0 && pose.health < (zb.variant === ZombieVariant.Crimson ? 30 : 50);
    let length = 0;
    if (enraged && !zb.enraged) {
      length = sounds.play('zombieGrowl', { at, volume: 1.1, maxDistance: 45, channel: zb });
    } else if (now >= zb.voiceAt) {
      if (enraged) length = sounds.play('zombieGrowl', { at, volume: 1.1, maxDistance: 45, channel: zb });
      else {
        let pick = 1 + Math.floor(Math.random() * 4);
        if (pick === zb.lastGroan) pick = (pick % 4) + 1;
        zb.lastGroan = pick;
        length = sounds.play(`zombieGroan${pick}` as 'zombieGroan1', { at, volume: 0.75, maxDistance: 35, channel: zb });
      }
    } else {
      zb.enraged = enraged;
      return;
    }
    zb.enraged = enraged;
    zb.voiceAt = now + length * 1000 + 1000 + Math.random() * 3000;
  }

  /** Testing aid: jump the world clock (0…1, 0.5 = noon). */
  setPvp(enabled: boolean): void { this.conn.sendPvp(enabled); }
  /** Infection: choose the weapons for this and every later human life. */
  setLoadout(loadout: { primary: string; secondary: string; melee: string }): void { this.conn.sendLoadout(loadout); }

  setTimeOfDay(tod: number): void {
    this.conn.sendSetTime(tod);
  }

  /** The optic in use: the fitted attachment, else the weapon's own sight (rocket launcher). */
  private currentOptic() {
    return weaponOptic(this.inventory.equippedItemId(), this.inventory.equippedAttachments());
  }

  private onMessage(m: ServerJsonMessage): void {
    if (this.building?.onMessage(m)) return;
    switch (m.t) {
      case 'baseLife': {
        if (m.objects) clearPending('plant');
        // Partial updates: keep whatever this message leaves out.
        const prev = this.hud.get().life;
        const config = m.config ?? prev?.config;
        if (!config) break;
        const life = { ...prev, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)), config } as LifeState;
        this.hud.set({ life });
        if (m.objects) {
          this.lifeRenderer ??= new BaseLifeRenderer(this.scene);
          void this.lifeRenderer.update(m.objects).catch((err: unknown) => console.error('Base life model loading failed', err));
        }
        break;
      }
      case 'questNpcs':
        this.questNpcDefinitions = m.npcs;
        break;
      case 'distress':
        this.distress.set(m.playerId, { name: m.name, x: m.x, z: m.z, until: performance.now() + 90_000 });
        this.toast({ key: 'raw', vars: { text: `${m.name} đang gục và cần cấp cứu!` } });
        break;
      case 'reviving':
        this.hud.set({ reviving: m.target ? { start: performance.now(), end: performance.now() + m.durationMs } : null });
        break;
      case 'pvp':
        this.hud.set({ pvpEnabled: m.enabled, pvpRemaining: Math.ceil(m.remainingMs / 1000) });
        break;
      case 'waves':
        this.hud.set({ waves: m });
        if (m.phase === 'over') clearActiveMatch();
        break;
      case 'infection': {
        const before = this.hud.get().infection;
        this.hud.set({ infection: m });
        this.infectedIds = new Set(m.zombieIds);
        const turned = !!m.infected && !this.selfInfected;
        this.selfInfected = !!m.infected;
        if (this.local) this.local.jumpMul = this.selfInfected ? this.infectionRules.zombieJump : 1;
        this.syncArmor();
        // A new round: the weapon picker opens by itself while the countdown runs.
        if (m.phase === 'countdown' && before?.phase !== 'countdown' && !m.infected) this.inventory.setOpen(true);
        this.hud.set({ infection: m });
        if (turned) { this.inventory.setOpen(false); this.hud.set({ hurtAt: performance.now(), hurtAmount: 1 }); this.sounds?.play('knockdown', { volume: .9 }); }
        break;
      }
      case 'battle': {
        const lobby = m.phase === 'waiting' || m.phase === 'countdown';
        const wasLobby = this.hud.get().battle?.phase === 'waiting' || this.hud.get().battle?.phase === 'countdown';
        this.hud.set({ battle: m });
        // The lobby ring holds everyone in (the server enforces it; predicting it avoids snapping back).
        if (this.local) this.local.fence = lobby ? m.lobby ?? null : null;
        // Names over heads while everyone gathers in the lobby; hidden once the match runs.
        if (lobby !== wasLobby) for (const [id, r] of this.remotes) r.avatar.setName(this.remoteName(id, r.entity.kind), this.ranks.get(id), this.pvpNames.has(id));
        this.planeReceivedAt = performance.now();
        if (m.phase === 'finished') this.input.release();
        break;
      }
      case 'door': {
        const was = this.doors.get(m.id)?.open;
        this.doors.set(m.id, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, open: m.open });
        this.store?.collision.setOwnerColliders(0xb0000000 + m.id, doorColliders(m));
        this.battleFlight?.door(m);
        if (was !== undefined && was !== m.open) this.sounds?.play(m.open ? 'doorOpen' : 'doorClose', { volume: .8, at: m });
        break;
      }
      case 'vehicles': {
        this.vehicles?.sync(m);

        if (this.local) this.local.riding = m.vehicles.some(v => vehicleSeatOf(v, this.welcome!.playerId) >= 0);
        break;
      }
      case 'tutorialState':
        this.hud.set({ tutorial: m });
        break;
      case 'speech':
        this.showSpeech(m.npc, m.text, m.duration, m.x, m.y, m.z);
        break;
      case 'quests': {
        clearPending('quest:*');
        // Jingles for a quest just taken or just completed.
        const before = new Map(this.hud.get().quests.map((q) => [q.id, q.status]));
        if (before.size) {
          if (m.entries.some((q) => q.status === 'claimed' && before.get(q.id) !== 'claimed')) this.sounds?.play('questComplete', { volume: 0.7 });
          else if (m.entries.some((q) => q.status === 'active' && (before.get(q.id) === 'available' || before.get(q.id) === 'cancelled'))) this.sounds?.play('questAccept', { volume: 0.7 });
        }
        this.hud.set({ quests: m.entries });
        this.renderQuestDrops(m.entries);
        break;
      }
      case 'pong':
        this.clock.onPong(m.ct, m.st);
        break;
      case 'players':
        this.pvpNames.clear();
        for (const p of m.players) if (p.pvp) this.pvpNames.add(p.id);
        this.names.clear();
        this.ranks.clear();
        for (const p of m.players) { this.names.set(p.id, p.name); if (p.rank) this.ranks.set(p.id, p.rank); }
        for (const p of m.players) {
          const look = p.look ?? randomAppearance(p.id);
          if (sameAppearance(this.looks.get(p.id), look)) continue;
          this.looks.set(p.id, look);
          if (p.id === this.welcome?.playerId) { if (p.look) this.applyOwnLook(p.look); }
          else { const r = this.remotes.get(p.id); if (r?.entity.kind === EntityKind.Player) r.avatar.setAppearance(look); }
        }
        for (const [id, r] of this.remotes) r.avatar.setName(this.remoteName(id, r.entity.kind), this.ranks.get(id), this.pvpNames.has(id));
        this.hud.set({ playersOnline: m.players.length, selfId: this.welcome?.playerId ?? 0, scorePlayers: m.players.map((p) => ({ id: p.id, name: p.name, rank: p.rank?.title, kills: p.kills ?? 0, deaths: p.deaths ?? 0, dead: !!p.dead, zombie: !!p.zombie, bot: !!p.bot })) });
        break;
      case 'teamState': {
        const previous = this.hud.get().team;
        const seen = new Set(previous?.id === m.team?.id ? previous?.chat.map((line) => line.id) : []);
        if (previous?.id !== m.team?.id) this.hud.set({ chat: this.hud.get().chat.filter((line) => line.channel !== 'team') });
        for (const line of m.team?.chat ?? []) if (!seen.has(line.id)) this.hud.pushChat({ from: line.from, text: line.text, channel: 'team', rank: line.rank });
        const quests = [...this.hud.get().quests.filter((q) => !q.team), ...m.quests];
        const before = new Map(this.hud.get().quests.map((q) => [q.id, q.status]));
        if (m.quests.some((q) => q.status === 'claimed' && before.get(q.id) !== 'claimed')) this.sounds?.play('questComplete', { volume: 0.7 });
        else if (m.quests.some((q) => q.status === 'active' && before.get(q.id) === 'available')) this.sounds?.play('questAccept', { volume: 0.7 });
        this.hud.set({ team: m.team, quests });
        this.renderQuestDrops(quests);
        clearPending('quest:team_*');
        break;
      }
      case 'chat': {
        this.hud.pushChat({ from: m.from, text: m.text, system: m.system, channel: m.channel, rank: m.rank, announcement: m.announcement });
        if (!m.system && (m.channel ?? 'world') === 'world') {
          const position = m.fromId === this.welcome?.playerId ? this.localAvatar?.root.position : this.remotes.get(m.fromId)?.avatar.root.position;
          if (position) this.showSpeech(m.fromId, m.text, Math.min(8000, Math.max(4000, m.text.length * 65)), position.x, position.y, position.z, true);
        }
        break;
      }
      case 'rank':
        this.hud.set({ rank: m.rank, ...(m.promoted ? { promotion: { rank: m.rank, introduction: m.introduction ?? '', at: Date.now() } } : {}) });
        if (m.promoted) this.sounds?.play('questComplete', { volume: .9 });
        break;
      case 'hit':
        // Hit marker: one of our shots or blows connected with someone else.
        if (m.attackerId === this.welcome?.playerId && m.targetId !== m.attackerId && m.damage > 0) {
          const head = m.zone === 'head' || m.zone === 'decapitation';
          this.hud.set({ hitMarkAt: performance.now(), hitMarkHead: head });
          const now = performance.now();
          if (weaponSpec(this.equippedWeapon())?.kind === 'melee' && now - this.meleeFeel.lastSwing < 900) {
            // Our blow landed: hit-stop, punch and the layered impact (instead of the gun tick).
            this.meleeFeel.impact(now, { head, damage: m.damage, slash: m.zone === 'slash' || m.zone === 'decapitation' });
            if (this.meleeFeel.combo >= 2) this.hud.set({ meleeCombo: { n: this.meleeFeel.combo, at: now } });
          } else {
            // A crisp tick on every hit, a bright ring on head shots (heard only by the shooter).
            this.sounds?.play('bulletHit', { volume: .75, rate: .96 + Math.random() * .08 });
            if (head) this.sounds?.play('headshot', { volume: .45 });
          }
        }
        if (m.targetId === this.welcome?.playerId && m.attackerId && m.attackerId !== m.targetId && this.local) {
          // Damage direction: where the hit came from, relative to where we are looking.
          const from = this.remotes.get(m.attackerId)?.entity.pose ?? this.zombies.get(m.attackerId)?.entity.pose;
          if (from) {
            const bearing = Math.atan2(-(from.x - this.local.state.x), -(from.z - this.local.state.z));
            const relative = Math.atan2(Math.sin(bearing - this.input.yaw), Math.cos(bearing - this.input.yaw));
            this.hud.set({ damageDirAt: performance.now(), damageDir: relative });
          }
        }
        // Infection: bullets shove a zombie back; mirror the server's push in our own prediction.
        if (m.targetId === this.welcome?.playerId && this.selfInfected && this.local && m.kx !== undefined && m.kz !== undefined && m.force) {
          const st = this.local.state;
          let px = (st.pushX ?? 0) + m.kx * m.force, pz = (st.pushZ ?? 0) + m.kz * m.force;
          const len = Math.hypot(px, pz);
          if (len > this.infectionRules.knockMax) { px *= this.infectionRules.knockMax / len; pz *= this.infectionRules.knockMax / len; }
          st.pushX = px; st.pushZ = pz;
        }
        if (m.zone === 'decapitation') this.zombies.get(m.targetId)?.avatar.severHead(m.kx ?? 0, m.kz ?? 1, m.force ?? 4);
        if (m.zone === 'slash' && m.damage > 0) this.sounds?.play('hitFlesh', { at: { x: m.x, y: m.y, z: m.z }, volume: 0.8, maxDistance: 25 });
        if (m.zone === 'fire') {
          // Flames: no blood, the target catches fire for a moment (refreshed while it burns).
          const zb = this.zombies.get(m.targetId);
          if (zb) zb.burnUntil = performance.now() + 700;
          const animal = this.remotes.get(m.targetId);
          if (animal?.entity.kind === EntityKind.Animal) animal.burnUntil = performance.now() + 700;
          if (m.targetId === this.welcome?.playerId) { this.healBreakAt = performance.now(); this.hud.set({ hurtAt: this.healBreakAt, hurtAmount: 0.4 }); }
          break;
        }
        if (m.zone === 'red_zone') {
          // The zone burns steadily: a faint flash, no blood, and first aid keeps going.
          if (m.targetId === this.welcome?.playerId) this.hud.set({ hurtAt: performance.now(), hurtAmount: 0.25 });
          break;
        }
        // A bucket over a zombie's head rings (and flies off when it breaks): no blood.
        if (m.zone === 'bucket' || m.zone === 'bucket_break') {
          this.sounds?.play('bulletHit', { at: { x: m.x, y: m.y, z: m.z }, volume: 1, rate: .55, maxDistance: 40 });
          if (this.effects) ParticleFX.burning(this.effects.particles, m.x, m.y, m.z);
          break;
        }
        this.bloodAt(m);
        if (m.targetId === this.welcome?.playerId) { this.healBreakAt = performance.now(); this.hud.set({ hurtAt: this.healBreakAt, hurtAmount: Math.min(1, 0.35 + m.damage / 40) }); }
        break;
      case 'death':
        // Our own death: remember who did it (solo battle royale follows them).
        if (m.playerId === this.welcome?.playerId) this.killerId = m.killerId !== m.playerId ? m.killerId ?? null : null;
        if (m.killerId === this.welcome?.playerId && m.playerId !== m.killerId) {
          // Kill confirmation: banner and a streak that keeps counting for a few seconds.
          const now = performance.now(), hud = this.hud.get();
          const name = isZombieId(m.playerId) ? 'Zombie' : this.names.get(m.playerId) ?? 'Đối thủ';
          this.hud.set({ killAt: now, killName: name, killStreak: now - hud.killAt < 6000 ? hud.killStreak + 1 : 1 });
          if (weaponSpec(this.equippedWeapon())?.kind === 'melee' && now - this.meleeFeel.lastSwing < 1200) this.meleeFeel.kill(now);
        }
        if (!isZombieId(m.playerId)) {
          // Players go limp and are thrown back by the killing hit.
          const av = m.playerId === this.welcome?.playerId ? this.localAvatar : this.remotes.get(m.playerId)?.avatar;
          const h = this.lastHits.get(m.playerId) ?? { kx: 0, kz: 1, force: 2 };
          av?.startRagdoll(h.kx, h.kz, h.force, (x, z) => this.groundY(x, z));
          this.lastHits.delete(m.playerId);
        }
        if (m.playerId === this.welcome?.playerId) {
          this.deadSince = performance.now();
          this.inventory.setOpen(false);
          this.closeDialogue();
        }
        else if (isZombieId(m.playerId)) {
          // Same connected, limp-body death simulation as the player.
          const zb = this.zombies.get(m.playerId);
          if (zb) {
            zb.dead = true;
            this.sounds?.stop(zb);
          }
          if (zb) {
            const hit = zb.lastHit ?? { kx: 0, kz: 1, force: 2 };
            zb.avatar.startRagdoll(hit.kx, hit.kz, hit.force, (x, z) => this.groundY(x, z));
          }
          this.lastHits.delete(m.playerId);
          break;
        }
        else {
          const name = this.names.get(m.playerId);
          this.hud.pushChat({ from: 'world', text: '', system: true, msg: { key: 'chat.died', vars: { name: name ?? '' } } });
        }
        break;
      case 'respawn':
        if (m.playerId === this.welcome?.playerId) this.local?.teleport(m.x, m.y, m.z);
        break;
      case 'shot': {
        if (m.shooterId === this.welcome?.playerId) break; // already shown when we pulled the trigger
        const shooter = this.remotes.get(m.shooterId)?.avatar;
        const muzzle = shooter?.weaponPoint('muzzle', this.tmpA) ? this.tmpA : this.tmpA.set(m.ox, m.oy, m.oz);
        // Effects use the same animated bore as the held model.
        const yaw = this.remotes.get(m.shooterId)?.entity.pose.yaw ?? 0;
        const dir = m.ends.length >= 3
          ? this.tmpB.set(m.ends[0]! - m.ox, m.ends[1]! - m.oy, m.ends[2]! - m.oz).normalize()
          : this.tmpB.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        shooter?.weaponBore(muzzle, dir);
        // Their spent case from their gun's ejection port, out to its right.
        const eject = shooter?.weaponPoint('eject', this.tmpC) ? this.tmpC : null;
        const right = eject ? new Vector3(-dir.z, 0, dir.x).normalize() : null;
        this.effects?.shot(m.shooterId, { weapon: m.w, muzzle, dir, eject, right, ends: m.ends, suppressed: m.sup === 1 });
        if (weaponSpec(m.w)?.kind === 'gun' && (weaponSpec(m.w) as { fire?: string }).fire !== 'flame') shooter?.kick(heavyKick(m.w) ? 0.35 : 0.12);
        break;
      }
      case 'grenade':
        this.effects?.throwGrenade(m.id, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, resting: false }, m.w);
        break;
      case 'c4':
        this.effects?.syncC4(m.charges);
        break;
      case 'explosion':
        this.effects?.explode(m.id, m.x, m.y, m.z, m.radius, m.kind);
        if (m.kind !== 'flash') this.shockwaves.add(m.x, m.y + .3, m.z, m.radius);
        // Close to a blast: the ears ring (a high whine over muffled hearing), more the closer.
        if (m.kind !== 'flash' && this.local && !this.local.dead) {
          const p = this.local.state, d = Math.hypot(p.x - m.x, p.y + 1.5 - m.y, p.z - m.z);
          const ring = Math.min(.85, Math.max(0, 1 - d / Math.max(8, m.radius * 3)) * 1.1);
          if (ring > .05) this.sounds?.stun(ring, 1600 + 2600 * ring);
        }
        break;
      case 'stagger':
        // Shot while infected: the same shove and slowness the server applies.
        if (this.local) { this.local.state.vx += m.vx; this.local.state.vz += m.vz; }
        if (this.local) { this.local.slowUntil = performance.now() + m.ms; this.local.slowFactor = m.factor; }
        break;
      case 'flashbang':
        // Blinded white and deafened, both easing back over the next seconds.
        this.sounds?.stun(m.strength, m.ms);
        this.flash.until = Math.max(this.flash.until, performance.now() + m.ms * m.strength * .55);
        this.flash.fade = Math.max(800, m.ms * m.strength * .9);
        this.flash.peak = Math.max(this.flash.peak * this.flashLevel(), Math.min(1, m.strength * 1.15));
        break;
      case 'smoke':
        this.effects?.smoke.add(m.id, m.x, m.y, m.z, m.radius, m.ms);
        break;
      case 'vegetation':
        this.vegetation?.applyDamage(m);
        break;
      case 'proj': {
        this.effects?.launch(m);
        if (m.kind === 'bullet' && m.ownerId !== this.welcome?.playerId) this.bulletWhiz(m);
        // Someone else's launcher: their muzzle blast and launch sound (ours played on the trigger).
        if (m.kind !== 'bullet' && m.ownerId !== this.welcome?.playerId) {
          const shooter = this.remotes.get(m.ownerId)?.avatar;
          const muzzle = shooter?.weaponPoint('muzzle', this.tmpA) ? this.tmpA : this.tmpA.set(m.x, m.y, m.z);
          const dir = this.tmpB.set(m.vx, m.vy, m.vz).normalize();
          this.effects?.shot(m.ownerId, { weapon: m.w, muzzle, dir, eject: null, right: null, ends: [] });
          shooter?.kick(0.35);
        }
        break;
      }
      case 'projEnd':
        this.effects?.endRound(m.id, m.x, m.y, m.z, m.hit, m.impact, m.normal);
        break;
      case 'armorHit':
        if (m.broke) this.toast({ key: 'toast.armor_broken' });
        break;
      case 'chest':
        this.inventory.applyChest(m);
        break;
      case 'inv':
        this.onInventory(m);
        break;
      case 'lootCrates':
        this.deathCrates.clear();
        for (const crate of m.crates) this.deathCrates.set(crate.id, crate);
        this.lootCrateRenderer ??= new BaseLifeRenderer(this.scene);
        void this.lootCrateRenderer.update(m.crates.map(crate => ({ ...crate, model: '/models/materias/old-wooden-crate.bbmodel' }))).catch(err => console.error('Loot crate model loading failed', err));
        this.lastStationScan = 0;
        break;
      case 'ground':
        for (const g of m.items) this.groundItems?.add(g.id, g.itemId, g.count, g.x, g.y, g.z, performance.now());
        this.lastStationScan = 0;
        break;
      case 'groundGone':
        this.groundItems?.removeId(m.id);
        this.lastStationScan = 0;
        break;
      case 'wallet':
        this.onWallet(m);
        break;
      case 'npcs':
        this.npcs = m.npcs;
        break;
      case 'coins':
        for (const d of m.drops) this.addCoinDrop(d.id, d.x, d.y, d.z, d.amount);
        break;
      case 'coinGone': {
        const o = this.coinDrops.get(m.id);
        if (o) {
          this.scene.remove(o);
          // A little chime when it was collected right next to us.
          const s = this.local?.state;
          if (s && (o.position.x - s.x) ** 2 + (o.position.z - s.z) ** 2 < 9) this.sounds?.play('glockReload', { rate: 2.2, volume: 0.35 });
        }
        this.coinDrops.delete(m.id);
        this.lastStationScan = 0;
        break;
      }
      case 'error':
        if (!m.fatal) this.toast({ key: 'raw', vars: { text: m.message } });
        break;
      default:
        break;
    }
  }

  private toast(msg: Msg): void {
    this.hud.set({ toast: msg });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hud.set({ toast: null }), 2200);
  }

  /* ------------------------------------- frame loop -------------------------------------- */

  private frameErrors = 0;
  private contextTimer = 0;
  private contextLost = false;
  private onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed || this.contextLost) return;
    this.contextLost = true;
    this.input.release();
    this.toast({ key: 'raw', vars: { text: 'Mất ngữ cảnh đồ họa, đang khôi phục…' } });
    window.clearTimeout(this.contextTimer);
    this.contextTimer = window.setTimeout(() => {
      if (!this.disposed && this.contextLost) this.hud.set({ status: 'disconnected', statusDetail: { key: 'raw', vars: { text: 'GPU chưa khôi phục. Hãy trở về sảnh và vào lại để thử lại.' } } });
    }, 15000);
  };
  private onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    window.clearTimeout(this.contextTimer);
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.hud.set({ status: 'loading', statusDetail: { key: 'status.preparing' } });
    this.toast({ key: 'raw', vars: { text: 'Đã khôi phục đồ họa.' } });
  };

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.contextLost) { this.lastFrame = now; return; }
    // One bad frame (a stray exception mid-update) must never freeze the view on a white/black
    // screen: log it, skip to rendering, and keep going.
    try {
      this.profiler?.begin();
      this.frameBody(now);
      this.showTalking();
      this.profiler?.end();
    } catch (err) {
      if (this.frameErrors++ < 5) console.error('frame failed', err);
      try { this.renderer.render(this.scene, this.camera); } catch { /* lost context */ }
    }
  };

  private frameBody(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;
    this.frames++;
    this.applyViewMode();

    const local = this.local;
    const store = this.store;
    if (!local || !store || !this.sky) return;
    this.vehicles?.update(dt, now, this.welcome!.playerId, local.state.x, local.state.y, local.state.z, this.input.locked && !this.input.suspended,this.clock.now(),this.input.axes().mz);
    // Aboard a vehicle: the driver steers it; a passenger rides along and can shoot.
    const aboard = this.vehicles?.rider(this.welcome!.playerId);
    this.passenger = !!aboard && (this.vehicles?.seatIndex(this.welcome!.playerId) ?? 0) > 0;
    const driving = this.passenger ? undefined : aboard;
    const seat = this.vehicles?.seat(this.welcome!.playerId);
    if (!!aboard !== local.riding) {
      this.vehicleCamera.reset(); this.camFocusInit = false;
      if (driving) { this.input.pitch = -.16; this.aiming = false; this.scoped = false; }
    }
    if (aboard) {
      // The view turns with the vehicle.
      const delta = this.drivingYaw === null ? (driving ? aboard.yaw - this.input.yaw : 0) : aboard.yaw - this.drivingYaw;
      const heading = this.input.yaw + Math.atan2(Math.sin(delta), Math.cos(delta));
      this.input.yaw = Math.atan2(Math.sin(heading), Math.cos(heading));
    }
    this.drivingYaw = aboard?.yaw ?? null;
    local.riding = !!aboard;
    this.applyViewMode();
    if (this.mouseLook && !this.camFocusInit) this.updateCamera(local.state.x, local.state.y, local.state.z, 0);

    const equipped = this.inventory.get().equipped;
    if (equipped !== this.recoilWeapon) { this.recoil.reset(); this.recoilWeapon = equipped; }
    // Equip before firing ticks so a swap cannot clear the first shot's recoil.
    // Placing a structure: the rolled-out blueprint is what the hands hold.
    this.viewModel?.set(this.building?.planItem ?? this.inventory.equippedItemId(), this.weapons, this.building?.planItem ? undefined : this.inventory.equippedAttachments());
    const offhand = this.inventory.get().items.find(i => i.container === 'offhand')?.itemId ?? null;
    this.viewModel?.setOffhand(offhand, this.weapons);
    if (this.mouseLook && !local.dead && this.hud.get().downed === null && this.input.locked && !this.input.suspended) {
      // Aiming down the sights the gun has weight: turning drags it and it swings past the mark
      // before settling; a magnified scope also drifts with the breath (stronger with more power).
      const aiming = this.aiming && weaponSpec(this.equippedWeapon())?.kind === 'gun' ? 1 : 0;
      const breath = this.scoped ? .0006 * Math.min(3, Math.max(1, (this.currentOptic()?.magnification ?? 1) / 2.5)) : 0;
      const sway = this.aimSway.step(this.input.yaw, this.input.pitch, dt, aiming, breath);
      this.input.yaw += sway.yaw; this.input.pitch += sway.pitch;
      // Change the actual input pitch so the camera, centre reticle and authoritative shots agree.
      const aim = this.recoil.apply(this.input.yaw, this.input.pitch, dt);
      this.input.yaw = Math.atan2(Math.sin(aim.yaw), Math.cos(aim.yaw));
      this.input.pitch = aim.pitch;
      this.aimSway.settle(this.input.yaw, this.input.pitch);
    } else { this.recoil.reset(); this.aimSway.reset(); }

    // Fixed-rate input + prediction, exactly mirroring the server tick.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < 5) {
      this.fixedStep(local);
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps === 5) this.accumulator = 0;
    local.decayCorrection(dt);

    const alpha = this.accumulator / TICK_DT;
    let px = seat?.x ?? local.prev.x + (local.state.x - local.prev.x) * alpha + local.correction.x;
    let py = seat?.y ?? local.prev.y + (local.state.y - local.prev.y) * alpha + local.correction.y;
    let pz = seat?.z ?? local.prev.z + (local.state.z - local.prev.z) * alpha + local.correction.z;
    if (!local.dead) this.worldMap.explore(px, pz);
    // Spectating: the whole frame (props, vegetation, vision, sky, sounds) centres on the watched
    // teammate, not on our own body far away — otherwise their surroundings never build and the
    // vision cone from our corpse hides them.
    const watch = this.spectateTarget();
    if (watch) { px = watch.x; py = watch.y; pz = watch.z; }

    const buildDeadline = performance.now() + MESH_BUILD_BUDGET_MS;
    this.props?.update(px, pz, now, buildDeadline);
    this.processBuildQueue(px, pz, buildDeadline);
    this.vegetation?.update(px, pz, false, buildDeadline);
    if (this.effects) this.vegetation?.emitBurning(this.clock.now(), (x, y, z) => {
      ParticleFX.burning(this.effects!.particles, x, y, z);
    });

    // Remote players render INTERPOLATION_DELAY in the past between two snapshots.
    const renderTime = this.clock.now() - INTERPOLATION_DELAY_MS;
    this.updateAim(px, py, pz);
    // Detection uses this frame's eye position and facing, before rendering any target.
    this.vision?.update(px, py + characterEyeHeight(local.state), pz, this.input.yaw, 0, this.sky.night, this.camera, py, this.store?.collision);
    this.outlinedZombies.length = 0;
    this.whiteOutlines.clear();
    this.xrayOutlines.clear();
    const sniffing = this.selfInfected && performance.now() < this.hud.get().sniffUntil;
    for (const r of this.remotes.values()) {
      const pose = r.entity.sample(renderTime);
      const itemId = ITEM_BY_WEAPON[r.weapon] ?? null;
      r.avatar.setWeapon(this.vehicles?.seatIndex(r.entity.id) === 0 ? null : itemId, this.weapons, r.att ? unpackAttachments(r.att) : undefined);
      r.avatar.setOffhand((pose.flags & EntityFlags.Flashlight) ? 'flashlight' : null, this.weapons);
      r.avatar.setGear(unpackGear(r.back ?? 0, r.gear ?? 0, r.pack ?? 0, (w) => ITEM_BY_WEAPON[w]), this.weapons);
      r.avatar.setStance(itemId ? (ITEMS[itemId]?.stance ?? 'unarmed') : 'unarmed');
      r.avatar.setAimPitch(pose.pitch);
      r.avatar.setInfected(this.infectedIds.has(r.entity.id));
      r.avatar.healing = (pose.flags & EntityFlags.Healing) !== 0;
      r.avatar.update(pose.x, pose.y, pose.z, pose.yaw, pose.flags, dt, this.elapsed);
      r.avatar.flightPose(pose.flags, (pose.flags & EntityFlags.Sprinting) !== 0, !(pose.flags & EntityFlags.Sprinting), dt);
      { const m = this.mantleGrip(r.entity.id, pose.flags, pose.x, pose.y, pose.z, pose.yaw); r.avatar.poseMantle(m?.grip ?? null, m?.k ?? 0, m?.clip ?? null); }
      r.avatar.posePlan((pose.flags & EntityFlags.Planning) !== 0);
      const ride = this.vehicles?.rider(r.entity.id);
      if (ride) { const p = this.vehicles!.seat(r.entity.id)!; r.avatar.root.position.set(p.x, p.y, p.z); }
      r.avatar.drivingPose(ride ? VEHICLES[ride.kind].quad : null, ride && this.vehicles!.seatIndex(r.entity.id) === 0 ? ride.yaw : pose.yaw,ride?.motion?.pitch,ride?.motion?.roll);
      const target = r.entity.kind === EntityKind.Player || r.entity.kind === EntityKind.Animal || r.entity.kind === EntityKind.Guard;
      // Visibility is recomputed every frame: once hidden by the vision cone, a body must come back
      // as soon as it is seen again (it used to stay hidden while its shots were still visible).
      r.avatar.root.visible = !(pose.flags & EntityFlags.InPlane);
      if (target && this.cameraMode === 'top-down') {
        r.avatar.root.visible &&= this.targetVisibility.visible(r.entity.id, this.vision?.canSee(pose.x, pose.y + .9, pose.z, this.store?.collision) ?? false, now);
        if (r.avatar.root.visible && pose.health > 0 && !(pose.flags & EntityFlags.Dead)) {
          this.outlinedZombies.push(r.avatar.root);
          // Players are outlined white, red only while they have PvP switched on.
          if (r.entity.kind === EntityKind.Player && !this.pvpNames.has(r.entity.id)) this.whiteOutlines.add(r.avatar.root);
        }
      }
      if (sniffing && r.entity.kind === EntityKind.Player && !this.infectedIds.has(r.entity.id) && pose.health > 0 && !(pose.flags & EntityFlags.Dead)
        && Math.hypot(pose.x - px, pose.y - py, pose.z - pz) <= SNIFF.range && !this.xrayOutlines.has(r.avatar.root)) {
        if (!this.outlinedZombies.includes(r.avatar.root)) this.outlinedZombies.push(r.avatar.root);
        this.whiteOutlines.delete(r.avatar.root);
        this.xrayOutlines.add(r.avatar.root);
      }
      if (r.burnUntil && r.burnUntil > now && r.avatar.root.visible && this.effects) ParticleFX.burning(this.effects.particles, pose.x, pose.y, pose.z);
      this.battleFlight?.player(r.entity.id, pose.x, pose.y, pose.z, pose.yaw, r.avatar.root.visible ? pose.flags : 0, dt);
      if (r.entity.kind === EntityKind.Guard && r.avatar.root.visible) this.guardPoses.push(pose);
      // Remote blade swings: a slash arc when their attack starts.
      const attacking = (pose.flags & EntityFlags.Attacking) !== 0;
      if (attacking && !r.attacking && r.avatar.root.visible && weaponSpec(r.weapon)?.kind === 'melee') this.slashAt(
        () => r.avatar.root.parent && r.avatar.root.visible && !(r.entity.pose.flags & EntityFlags.Dead) ? r.entity.pose : null,
        r.weapon, r.avatar.slashVariant,
      );
      r.attacking = attacking;
    }
    // Guards switch on flashlights at night, aimed where they look.
    this.guardPoses.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.guardFlashlights?.update(this.guardPoses, this.sky.night);
    this.guardPoses.length = 0;
    // Movement flags come from local prediction so jump/roll animations start on the key press,
    // not a round trip later; the rest (dead, attacking…) stays server-authoritative.
    const predicted = EntityFlags.Priming | EntityFlags.Grounded | EntityFlags.Swimming | EntityFlags.Rolling | EntityFlags.Climbing | EntityFlags.Sprinting | EntityFlags.Prone | EntityFlags.Aiming | EntityFlags.Crouching | EntityFlags.LeanLeft | EntityFlags.LeanRight | EntityFlags.Mantling;
    const selfLean = leanOf(local.lastButtons);
    const selfFlags =
      ((local.lastServer?.flags ?? 0) & ~predicted) |
      (local.state.grounded ? EntityFlags.Grounded : 0) |
      (local.state.swimming ? EntityFlags.Swimming : 0) |
      (local.state.rollTicks > 0 ? EntityFlags.Rolling : 0) |
      (local.state.prone ? EntityFlags.Prone : 0) |
      (local.state.crouched ? EntityFlags.Crouching : 0) |
      (selfLean < 0 ? EntityFlags.LeanLeft : selfLean > 0 ? EntityFlags.LeanRight : 0) |
      (this.aiming ? EntityFlags.Aiming : 0) |
      (local.lastButtons & Buttons.Sprint ? EntityFlags.Sprinting : 0) |
      (local.state.climbing ? EntityFlags.Climbing : 0) |
      (local.state.mantle ? EntityFlags.Mantling : 0) |
      (this.weaponCtl.primed ? EntityFlags.Priming : 0);
    this.scanStations(px, pz, now);
    this.updateHover();
    // Zombies: interpolated like players, but only visible inside the vision cone (or very close).
    for (const zb of this.zombies.values()) {
      const pose = zb.entity.sample(renderTime);
      const dx = pose.x - px;
      const dz = pose.z - pz;
      zb.avatar.seen = this.cameraMode !== 'top-down' || this.targetVisibility.visible(zb.entity.id, this.vision?.canSee(pose.x, pose.y + .9, pose.z, this.store?.collision) ?? false, now);
      zb.avatar.update(pose.x, pose.y, pose.z, pose.yaw, pose.flags, zb.limbs, dt, pose.health, pose.pitch);
      zb.avatar.root.visible = zb.avatar.seen;
      if (this.cameraMode === 'top-down' && zb.avatar.seen && zb.avatar.root.visible && pose.health > 0 && !(pose.flags & EntityFlags.Dead)) this.outlinedZombies.push(zb.avatar.root);
      if (zb.burnUntil && zb.burnUntil > now && zb.avatar.root.visible && this.effects) ParticleFX.burning(this.effects.particles, pose.x, pose.y, pose.z);
      this.zombieVoice(zb, pose, dx * dx + dz * dz);
    }
    this.updateCampfires(px, pz, now);
    this.updateFootsteps(dt);
    // Quest items: settle them on the ground once their terrain has streamed in.
    if (now - this.lastDropFix > 1000) {
      this.lastDropFix = now;
      const objects = this.hud.get().quests.flatMap((q) => q.status === 'active' && q.retrievalModel ? (q.drops ?? []).map((d, i) => ({ id: `${q.id}#${i}`, model: q.retrievalModel!, x: d.x, y: this.groundY(d.x, d.z), z: d.z })) : []);
      if (objects.length) void this.privateQuestRenderer?.update(objects).catch(() => undefined);
    }
    this.localAvatar?.setStance(this.inventory.stance());
    this.localAvatar?.setWeapon(driving ? null : this.inventory.equippedItemId(), this.weapons, this.inventory.equippedAttachments());
    this.localAvatar?.setOffhand(offhand, this.weapons);
    { const st = this.inventory.get(); this.localAvatar?.setGear(carriedGear(st.items, st.equipped), this.weapons); }
    this.localAvatar?.setAimPitch(this.shotPitch);
    this.localAvatar?.setInfected(this.selfInfected);
    if (this.localAvatar) {
      this.localAvatar.viewAligned = this.mouseLook;
      // Pressing attack (shoot, swing, throw) turns the body to the mouse before the server echoes it.
      this.localAvatar.attackIntent = (this.input.buttons() & (Buttons.Attack | Buttons.ThrowC4)) !== 0 && !local.state.swimming && !this.building?.planning;
    }
    this.feel = this.meleeFeel.update(dt, performance.now());
    this.localAvatar?.update(px, py, pz, this.shotYaw, selfFlags, dt * this.feel.timeScale, this.elapsed, local.state, dt);
    { const m = this.mantleGrip(-1, local.state.mantle ? EntityFlags.Mantling : 0, local.state.x, local.state.y, local.state.z, this.input.yaw, local.state.mantle); this.localAvatar?.poseMantle(m?.grip ?? null, m?.k ?? 0, m?.clip ?? null); }
    this.localAvatar?.posePlan(!!this.building?.planning);
    // Battle royale squad: diamond + name over every living teammate, through walls; follows the
    // rendered body when it is streamed in, else the last reported team position.
    this.squadMarkers.update(this.welcome?.mode !== 'battle-royale' ? [] : (this.hud.get().team?.members ?? []).flatMap((m) => {
      if (m.entityId === undefined || m.entityId === this.welcome?.playerId || !m.inGame || (m.health ?? 1) <= 0 || m.x === undefined) return [];
      const body = this.remotes.get(m.entityId);
      if (body && body.entity.pose.flags & EntityFlags.Dead) return [];
      const at = body?.avatar.root.visible ? body.avatar.root.position : { x: m.x, y: m.y ?? 0, z: m.z! };
      return [{ id: m.entityId, name: m.name, x: at.x, y: at.y + 2.35, z: at.z }];
    }));
    const flightFlags = local.state.flight === 1 ? EntityFlags.InPlane : local.state.flight === 2 ? EntityFlags.Freefall : local.state.flight === 3 ? EntityFlags.Parachute : 0;
    this.localAvatar?.flightPose(flightFlags, (local.lastButtons & Buttons.Sprint) !== 0, Math.hypot(local.state.vx, local.state.vz) > 2, dt);
    this.localAvatar?.drivingPose(aboard ? VEHICLES[aboard.kind].quad : null, driving?.yaw ?? this.input.yaw,aboard?.motion?.pitch,aboard?.motion?.roll);
    this.viewModel?.setVisible(!driving);
    this.battleFlight?.player(this.welcome!.playerId, px, py, pz, this.input.yaw, flightFlags, dt);
    const battle = this.hud.get().battle;
    this.updateCrosshair(dt);
    this.updateFlash();
    const live = this.liveBattle();
    // The power grid (island pylons, survival roadside poles) comes with the map atlas; string the cables once it arrives.
    if (!this.powerCables && this.worldMap.get().atlas?.cables) this.powerCables = new PowerCables(this.scene, this.worldMap.get().atlas!.cables!);
    if (live) this.battleZone?.update(live);
    const plane = battle?.plane ? battlePlaneAt(this.welcome!.world.sizeChunks * CHUNK_SIZE, BATTLE_FLIGHT.durationMs - battle.plane.remainingMs + performance.now() - this.planeReceivedAt) : undefined;
    this.battleFlight?.update(dt, this.elapsed, px, pz, plane && plane.remainingMs > 0 ? plane : undefined);
    this.battleFlight?.retainPlayers(new Set([this.welcome!.playerId, ...this.remotes.keys()]));
    if (plane && plane.remainingMs > 0) this.sounds?.loopAt(this.battleFlight!, 'transportPlane', { volume: local.state.flight === 1 ? .8 : .65, at: local.state.flight === 1 ? undefined : plane, maxDistance: 1200 });
    else if (this.battleFlight) this.sounds?.stopLoop(this.battleFlight);
    if (this.localAvatar && this.firstPerson && !local.state.flight) this.localAvatar.root.visible = false;
    if (this.viewModel) {
      const axes = this.input.axes();
      this.viewModel.update(dt * this.feel.timeScale, {
        visible: this.eyeView && (!this.scoped || this.lensScoped) && !local.dead && !local.state.flight && !driving,
        moving: axes.mx !== 0 || axes.mz !== 0,
        sprint: (local.lastButtons & Buttons.Sprint) !== 0,
        reloading: this.weaponCtl.reloading,
        firing: !local.state.swimming && weaponSpec(this.equippedWeapon())?.kind === 'gun' && (this.input.buttons() & Buttons.Attack) !== 0,
        aiming: this.aiming,
        swimming: local.state.swimming,
        rolling: local.state.rollTicks > 0,
        mantle: this.mantleGrip(-1, local.state.mantle ? EntityFlags.Mantling : 0, local.state.x, local.state.y, local.state.z, this.input.yaw, local.state.mantle)?.grip ?? null,
        yaw: this.input.yaw,
        pitch: this.input.pitch,
      });
    }

    // Day/night: server time of day, advanced locally between snapshots.
    const daySec = this.welcome!.world.dayLengthSec;
    const tod = this.welcome!.mode === 'battle-royale' ? BATTLE_TIME_OF_DAY : this.welcome!.mode === 'infection' || this.welcome!.mode === 'waves' ? this.infectionRules.timeOfDay : (this.timeOfDay + (now - this.todAt) / 1000 / daySec) % 1;
    this.focus.set(px, py, pz);
    this.sky.update(tod, this.elapsed, this.focus, this.clock.now() / 1000);
    this.campLights?.update(store.chunks.values(), px, pz, this.sky.night, now);
    this.updateRockMoss(store.chunks, px, pz, now);
    if (!this.spectate(dt)) this.updateCamera(px, py, pz, dt);
    if (this.localAvatar && this.cameraMode === 'third-person' && !local.state.flight) this.localAvatar.root.visible = !this.eyeView && (driving ? this.vehicleCamera.distance : this.thirdPersonCamera.distance) > (this.shoulderSights ? .45 : .75);
    this.updateShoulderAim(px, py, pz);
    if (this.eyeView && this.viewModel) {
      this.raycaster.setFromCamera(this.ndc.set(0, 0), this.camera);
      const ray = this.raycaster.ray;
      let distance = 100;
      if (store.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance, Mask.Weapon, this.shotRay)) distance = this.shotRay.t;
      distance = this.bodyHit(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance);
      this.viewModel.aimAt(this.tmpC.copy(ray.direction).multiplyScalar(Math.max(1, distance)).add(ray.origin));
    }
    this.updateFlashlights();
    for (const msg of this.pendingWeaponInputs.splice(0)) {
      if (weaponSpec(msg.w ?? 0)?.kind === 'gun' && this.localWeaponBore(this.tmpA, this.tmpB)) {
        this.towardsAim(this.tmpA, this.tmpB);
        const x = this.tmpA.x - px, y = this.tmpA.y - py, z = this.tmpA.z - pz;
        if (Math.hypot(x, z) <= 2.4 && y >= -.5 && y <= 3) {
          msg.bore = { x, y, z, dx: this.tmpB.x, dy: this.tmpB.y, dz: this.tmpB.z };
        }
      }
      this.conn.sendInput(msg);
    }
    for (const shot of this.pendingLocalShots.splice(0)) shot();
    this.updateLaser(px, py, pz);
    const optic = this.currentOptic();
    const scopeMagnification = this.scoped ? optic?.magnification ?? 1 : 1;
    // Red dot: the reticle is drawn on the aiming ray once the sight is up to the eye.
    const reticle = this.scoped ? optic?.reticle ?? null : (optic?.reticle === 'dot' || optic?.reticle === 'holo') && this.aiming && this.firstPerson && (this.viewModel?.aimed ?? 0) > .82 ? optic!.reticle! : null;
    const nightVision = this.scoped && !!optic?.nightVision && this.nightVision;
    const nvScope = this.scoped && !!optic?.nightVision;
    const hud = this.hud.get();
    // Night vision amplifies the light inside the lens (everything else is the scope housing),
    // so dark scenes read clearly without seeing through anything that blocks the view.
    const lensSight = this.lensSight;
    const exposure = settingsStore.get().brightness * (nightVision && !this.lensScoped ? 3.2 : 1);
    if (Math.abs(this.renderer.toneMappingExposure - exposure) > 1e-3) this.renderer.toneMappingExposure = exposure;
    if (hud.aiming !== this.aiming || hud.scoped !== this.scoped || hud.scopeMagnification !== scopeMagnification || hud.reticle !== reticle || hud.nightVision !== nightVision || hud.nvScope !== nvScope || hud.lensScope !== lensSight) {
      this.hud.set({ aiming: this.aiming, scoped: this.scoped, scopeMagnification, reticle, nightVision, nvScope, lensScope: lensSight });
    }
    this.vision?.update(px, py + characterEyeHeight(local.state), pz, this.input.yaw, 0, this.sky.night, this.camera, py, this.store?.collision);
    this.sky.follow(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    if (this.ocean) snapOcean(this.ocean, this.camera.position.x, this.camera.position.z, this.welcome!.world.seaLevel);
    if (this.waterMaterial) {
      const u = getWaterUniforms(this.waterMaterial);
      u.uTime.value = this.elapsed;
      u.uSunDir.value.copy(this.sky.sunDir);
      u.uSunColor.value.copy(this.sky.sunColor).multiplyScalar(1 - this.sky.night);
      u.uSkyColor.value.copy(this.sky.horizon);
      u.uLight.value = this.sky.lightLevel;
    }
    windUniforms.uTime.value = this.elapsed;
    if (this.localWeaponPoint('muzzle', this.tmpA)) this.effects?.trackMuzzle(this.welcome!.playerId, this.tmpA);
    for (const [id, r] of this.remotes) if (r.avatar.weaponPoint('muzzle', this.tmpA)) this.effects?.trackMuzzle(id, this.tmpA);
    this.effects?.update(dt, this.store?.collision);
    this.debris?.update(dt, this.store?.collision);
    this.groundItems?.update(now);
    this.building?.update(dt, this.elapsed);
    if (this.colliderDebug?.enabled) {
      const cam = this.camera.position, dir = this.camera.getWorldDirection(this.tmpB);
      this.colliderDebug.update(dt, this.store?.collision, cam.x, cam.y, cam.z, {
        vehicles: this.vehicles?.poses() ?? [], bodies: this.building?.bodies.bodies() ?? [],
        aim: { x: cam.x + dir.x * .3, y: cam.y + dir.y * .3, z: cam.z + dir.z * .3, dx: dir.x, dy: dir.y, dz: dir.z },
      });
    }
    this.slashes?.update(dt);
    this.updateHealing(now);
    for (const o of this.coinDrops.values()) {
      const coin = o.children[0];
      if (coin && o.children.length > 1) {
        coin.rotation.y = this.elapsed * 2.4;
        coin.position.y = 0.35 + Math.sin(this.elapsed * 3 + o.position.x) * 0.06;
      }
    }
    this.updateAmmoHud(now);

    this.profiler?.startRender();
    const lens = this.lensSight ? this.viewModel!.lens : null;
    if (lens && optic) {
      (this.scopeLens ??= new ScopeLens()).render(this.renderer, this.scene, this.camera, lens.mesh, this.viewModel!.scopeHidden, {
        magnification: optic.magnification ?? 1, reticle: optic.reticle ?? null, nightVision: !!optic.nightVision && this.nightVision,
      }, !(settingsStore.get().shaders && this.sky));
    } else {
      this.scopeLens?.release();
      if (this.lensScopeReady() && (optic?.magnification ?? 1) > 1) (this.scopeLens ??= new ScopeLens()).warm(this.renderer, this.viewModel!.lens!.mesh, this.camera);
    }
    if (settingsStore.get().shaders && this.sky) {
      this.shaderPack ??= new ShaderPack(this.renderer, this.scene, this.camera);
      const outlined = this.outlinedZombies.length > 0;
      if (outlined) this.zombieOutline ??= new ZombieOutline();
      this.shaderPack.render(this.camera, this.sky.sunDir, this.sky.night, this.elapsed, outlined ? (target) => {
        const before = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(target);
        this.zombieOutline!.render(this.renderer, this.scene, this.camera, this.outlinedZombies, this.whiteOutlines, this.xrayOutlines);
        this.renderer.setRenderTarget(before);
      } : undefined, this.nearBlurStrength());
    } else if (this.nearBlurStrength() > 0) {
      // The near blur over the plain render (and the zombie outlines, when shown).
      this.nearBlur ??= new NearBlur();
      const outlined = this.outlinedZombies.length > 0;
      if (outlined) this.zombieOutline ??= new ZombieOutline();
      this.nearBlur.render(this.renderer, this.scene, this.camera, this.nearBlurStrength(), outlined ? () => this.zombieOutline!.render(this.renderer, this.scene, this.camera, this.outlinedZombies, this.whiteOutlines, this.xrayOutlines) : undefined);
    } else if (this.outlinedZombies.length) {
      this.zombieOutline ??= new ZombieOutline();
      this.zombieOutline.render(this.renderer, this.scene, this.camera, this.outlinedZombies, this.whiteOutlines, this.xrayOutlines);
    } else this.renderer.render(this.scene, this.camera);
    if (this.shockwaves.active) this.shockwaves.render(this.renderer, this.camera);

    if (now - this.lastPing > PING_INTERVAL_MS) {
      this.lastPing = now;
      this.conn.sendPing();
    }
    this.updateHeadingHud(now, px, pz);
    if (now - this.lastMinimap > 330 && this.minimap) {
      this.lastMinimap = now;
      const teamIds = new Set(this.hud.get().team?.members.map((m) => m.entityId));
      const others = [...this.remotes.entries()].filter(([id, r]) => !teamIds.has(id) && r.avatar.root.visible && r.entity.kind !== EntityKind.Animal && r.entity.kind !== EntityKind.QuestNpc).map(([, r]) => ({ x: r.entity.pose.x, z: r.entity.pose.z }));
      const seenZombies = [...this.zombies.values()].filter((zb) => zb.avatar.seen && !(zb.entity.pose.flags & EntityFlags.Dead)).map((zb) => ({ x: zb.entity.pose.x, z: zb.entity.pose.z }));
      const teammates = (this.hud.get().team?.members ?? []).filter((m) => m.entityId !== this.welcome?.playerId && m.inGame && m.x !== undefined && m.z !== undefined).filter((m) => (m.health ?? 1) > 0).map((m) => ({ x: m.x!, z: m.z!, yaw: m.yaw }));
      this.minimap.draw(store.chunks.values(), px, pz, this.input.yaw, this.hud.get().mode === 'battle-royale' ? [] : others, seenZombies, this.minimapTint(), CAM_YAW, this.mapNpcs(), this.welcome?.world.camp ?? null, teammates, this.worldMap.get().locations, this.worldMap.get().arrows, this.liveBattle(), this.hud.get().supply);
    }
    this.updateSpeech(now);
    if (now - this.lastGuides > 100) {
      this.lastGuides = now;
      this.updateGuides(px, py, pz);
    }
    if (now - this.lastHud > HUD_INTERVAL_MS) this.updateHud(now, px, py, pz, tod, selfFlags);
  }

  /**
   * Edge-of-screen guides to the camp NPCs: within GUIDE_RANGE but off screen, a small arrow on the
   * screen border points at them, with their icon and distance.
   */
  private updateGuides(px: number, py: number, pz: number): void {
    const camp = this.welcome?.world.camp;
    const questNpc = this.questNpcDefinitions.find((n) => this.hud.get().quests.some((q) => q.npc === n.key && !q.locked && (q.status === 'available' || q.status === 'cancelled'))) ?? this.questNpcDefinitions[0];
    const merchant = this.npcs.find((n) => n.role === 'merchant');
    const targets = [questNpc ? { id: 'quest', x: questNpc.x, z: questNpc.z } : null, merchant ? { id: 'shop', x: merchant.x, z: merchant.z } : null, camp ? { id: 'gate', x: camp.x, z: camp.z + camp.halfSize - 3 } : null].filter((n): n is { id: string; x: number; z: number } => n !== null);
    const anchor = this.guideTmp.set(px, py + 1, pz).project(this.camera);
    const anchorX = this.firstPerson ? 0 : anchor.x, anchorY = this.firstPerson ? -0.25 : anchor.y;
    this.hud.set({ tutorialAnchor: { x: (anchorX + 1) * this.container.clientWidth / 2, y: (1 - anchorY) * this.container.clientHeight / 2 }, tutorialTargets: targets.map((n) => {
      const dx = n.x - px, dz = n.z - pz;
      // Screen-space bearing: x right, y down. First person: relative to the view direction.
      const yaw = this.input.yaw;
      const screenX = this.mouseLook ? Math.cos(yaw) * dx - Math.sin(yaw) * dz : Math.cos(CAM_YAW) * dx - Math.sin(CAM_YAW) * dz;
      const screenY = this.mouseLook ? Math.sin(yaw) * dx + Math.cos(yaw) * dz : Math.sin(CAM_PITCH) * (Math.sin(CAM_YAW) * dx + Math.cos(CAM_YAW) * dz);
      return { ...n, distance: Math.hypot(dx, dz), angle: Math.atan2(-screenX, screenY) };
    }) });
    const guides: HudState['guides'] = [];
    this.worldMap.updateFixed(this.mapNpcs());
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const guideLocations = this.worldMap.get().arrows ? this.worldMap.get().locations.filter((m) => m.guide).map((m) => ({ role: m.role ?? 'marker', x: m.x, z: m.z, quest: m.quest, icon: m.icon, name: m.name })) : [];
    const missionLocations = this.mapNpcs().filter((n) => n.role === 'sos' || (this.worldMap.get().arrows && n.role === 'target'));
    const locations: Array<{ role: string; x: number; z: number; quest?: boolean; icon?: string; name?: string }> = [...guideLocations, ...missionLocations];
    for (const n of locations) {
      const dist = Math.hypot(n.x - px, n.z - pz);
      if (dist > GUIDE_RANGE && n.role !== 'target' && n.role !== 'sos' && n.role !== 'marker') continue;
      const v = this.guideTmp.set(n.x, py + 1.6, n.z).project(this.camera);
      const behind = v.z > 1;
      if (!behind && Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.9) continue;
      // Direction in screen pixels (NDC scaled by the viewport's half size).
      let dx = (behind ? -v.x : v.x) * (w / 2);
      let dy = (behind ? -v.y : v.y) * (h / 2);
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      // Clamp onto a rectangle inset from the screen edges (screen y is down).
      const mx = w / 2 - 44;
      const my = h / 2 - 44;
      const k = Math.min(mx / Math.max(1e-3, Math.abs(dx)), my / Math.max(1e-3, Math.abs(dy)));
      guides.push({ role: n.role, quest: n.quest, icon: n.icon, name: n.name, x: w / 2 + dx * k, y: h / 2 - dy * k, angle: Math.atan2(-dy, dx), dist: Math.round(dist) });
    }
    const key = guides.map((g, i) => `${i}${g.role}${g.icon}${g.name}${g.quest ? '!' : ''}${Math.round(g.x)},${Math.round(g.y)},${g.dist}`).join('|');
    if (key !== this.guidesKey) {
      this.guidesKey = key;
      this.hud.set({ guides });
    }
  }

  private guidesKey = '';

  /** Speech bubbles follow rendered character positions, including world chat. */
  private bubbles: Array<{ el: HTMLDivElement; npc: number; x: number; y: number; z: number; until: number; player: boolean }> = [];

  private showSpeech(npc: number, text: string, duration: number, x: number, y: number, z: number, player = false): void {
    this.bubbles = this.bubbles.filter((b) => { if (b.npc !== npc) return true; b.el.remove(); return false; });
    const el = document.createElement('div');
    el.className = player ? 'speech-bubble player-speech' : 'speech-bubble';
    el.textContent = text;
    this.container.appendChild(el);
    this.bubbles.push({ el, npc, x, y, z, until: performance.now() + duration, player });
  }

  private updateSpeech(now: number): void {
    if (!this.bubbles.length) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.bubbles = this.bubbles.filter((b) => {
      if (now >= b.until) { b.el.remove(); return false; }
      const self = b.npc === this.welcome?.playerId;
      const pose = self ? this.localAvatar?.root.position : this.remotes.get(b.npc)?.avatar.root.position;
      if (b.player && !pose) { b.el.remove(); return false; }
      if (pose) { b.x = pose.x; b.y = pose.y; b.z = pose.z; }
      const v = this.guideTmp.set(b.x, b.y + 2.35, b.z).project(this.camera);
      const near = !b.player || this.camera.position.distanceToSquared(pose!) <= 35 * 35;
      const detected = self || this.cameraMode !== 'top-down' || this.remotes.get(b.npc)?.avatar.root.visible !== false;
      const visible = detected && near && !(b.player && self && this.mouseLook) && v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      b.el.style.display = visible ? '' : 'none';
      if (visible) b.el.style.transform = `translate(${Math.round((v.x + 1) * 0.5 * w)}px, ${Math.round((1 - v.y) * 0.5 * h)}px) translate(-50%, -100%)`;
      b.el.style.opacity = b.until - now < 300 ? String((b.until - now) / 300) : '1';
      return true;
    });
  }

  /** Service NPCs plus quest givers (with a "!" when they have a quest to offer or hand in). */
  private mapNpcs(): Array<{ role: string; x: number; z: number; quest?: boolean }> {
    const quests = this.hud.get().quests;
    return [
      ...this.npcs,
      ...this.questNpcDefinitions.map((n) => ({
        role: n.key, x: n.x, z: n.z,
        quest: quests.some((q) => q.npc === n.key && (q.status === 'ready' || ((q.status === 'available' || q.status === 'cancelled') && !q.locked))),
      })),
      // Downed players who called for help (until they are up again or gone).
      ...[...this.distress].filter(([id, d]) => {
        const r = this.remotes.get(id);
        const down = r ? (r.entity.pose.flags & EntityFlags.Downed) !== 0 : performance.now() < d.until;
        if (!down || performance.now() > d.until) this.distress.delete(id);
        return down;
      }).map(([id, d]) => {
        const p = this.remotes.get(id)?.entity.pose;
        return { role: 'sos', x: p?.x ?? d.x, z: p?.z ?? d.z };
      }),
      ...(this.storagePos() ? [{ role: 'storage', x: this.storagePos()!.x, z: this.storagePos()!.z }] : []),
      // Where an active quest wants us (private item to pick up, place to reach).
      ...quests.filter((q) => q.status === 'active' && q.target).flatMap((q) => (q.drops?.length ? q.drops : [q.target!]).map((t) => ({ role: 'target', x: t.x, z: t.z }))),
    ];
  }

  private fixedStep(local: LocalPlayer): void {
    if (!this.conn.open) return;
    if (local.riding && !this.passenger) {
      const axes = this.input.axes();
      this.aiming = false; this.scoped = false;
      this.conn.sendInput(local.step(axes.mx, axes.mz, this.input.yaw, this.input.pitch, 0, undefined));
      this.input.acknowledgeTouchPresses(); return;
    }
    if (local.state.flight) {
      const axes = this.input.axes(), buttons = this.input.buttons() & (Buttons.Jump | Buttons.Sprint);
      this.conn.sendInput(local.step(axes.mx, axes.mz, this.input.yaw, this.input.pitch, buttons, undefined));
      this.input.acknowledgeTouchPresses(); return;
    }
    this.updateShoulderAim(local.state.x, local.state.y, local.state.z);
    // Screen-relative WASD -> camera-yaw world direction -> the character's yaw-local axes.
    const a = this.input.axes();
    const cameraYaw = this.mouseLook ? this.input.yaw : CAM_YAW;
    let wx = Math.cos(cameraYaw) * a.mx - Math.sin(cameraYaw) * a.mz;
    let wz = -Math.sin(cameraYaw) * a.mx - Math.cos(cameraYaw) * a.mz;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }
    const y = this.input.yaw;
    // Camera-relative movement is independent of shoulder parallax in the aiming direction.
    const mx = this.mouseLook ? a.mx : Math.max(-1, Math.min(1, wx * Math.cos(y) - wz * Math.sin(y)));
    const mz = this.mouseLook ? a.mz : Math.max(-1, Math.min(1, -wx * Math.sin(y) - wz * Math.cos(y)));
    // The trigger becomes an attack only on ticks where the weapon actually fires.
    const weapon = this.equippedWeapon();
    let buttons = this.input.buttons();
    // Infection zombies only run, jump and swing (the server enforces the same).
    // Aiming at a wall's edge leans out past it by itself (every view; there are no lean keys).
    const peek = this.peek(performance.now());
    if (peek && !(buttons & (Buttons.LeanLeft | Buttons.LeanRight))) buttons |= peek < 0 ? Buttons.LeanLeft : Buttons.LeanRight;
    if (this.selfInfected) buttons &= ~(Buttons.Roll | Buttons.Prone | Buttons.Crouch | Buttons.LeanLeft | Buttons.LeanRight | Buttons.Aim | Buttons.ThrowC4 | Buttons.Heal);
    if ((buttons & Buttons.Prone) || local.state.prone) buttons &= ~(Buttons.Sprint | Buttons.Roll | Buttons.Crouch);
    if ((buttons & Buttons.Crouch) || local.state.crouched) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    if (local.state.swimming || local.state.climbing || local.state.prone) buttons &= ~(Buttons.LeanLeft | Buttons.LeanRight);
    if (local.state.swimming) buttons &= ~Buttons.Attack;
    // Holding a blueprint up: both hands on the sheet, no attacking or aiming.
    if (this.building?.planning) { buttons &= ~(Buttons.Attack | Buttons.Aim | Buttons.ThrowC4); buttons |= Buttons.Plan; }
    // Aim is separate from the trigger and available with iron sights as well as optics.
    const equippedSpec = weaponSpec(weapon);
    this.aiming = equippedSpec?.kind === 'gun' && !this.selfInfected && this.input.aiming && !this.weaponCtl.reloading && !local.dead && !local.state.swimming && this.hud.get().downed === null && local.state.grounded && local.state.rollTicks === 0;
    // Magnified optics take over the view; iron sights and red dots aim through the gun itself.
    this.scoped = this.aiming && equippedSpec?.kind === 'gun' && (this.currentOptic()?.magnification ?? 1) > 1;
    // Raising and lowering the sights: a short cloth-and-metal shuffle.
    if (this.aiming !== this.wasAiming) { this.sounds?.play(this.aiming ? 'partGunAim' : 'aimOut', { volume: this.aiming ? .45 : .35 }); this.wasAiming = this.aiming; }
    let moveX = mx;
    let moveZ = mz;
    if (this.aiming) { buttons |= Buttons.Aim; buttons &= ~Buttons.Sprint; }
    // A melee swing roots the feet until it ends (the server does the same); a lunge still carries.
    if (weaponSpec(weapon)?.kind === 'melee' && performance.now() < this.weaponCtl.swingUntil) { moveX = 0; moveZ = 0; buttons &= ~Buttons.Sprint; }
    // Down on the ground: no moving, no shooting (the server ignores it too).
    if (this.hud.get().downed !== null || this.local?.knocked) {
      moveX = 0;
      moveZ = 0;
      buttons = 0;
    }
    const trigger = (buttons & Buttons.Attack) !== 0;
    const c4Throw = (buttons & Buttons.ThrowC4) !== 0 || this.input.aiming;
    buttons &= ~(Buttons.Attack | Buttons.ThrowC4);
    // Exhausted (under 10% stamina): no sprinting or rolling (the server enforces the same).
    const life = this.hud.get().life;
    if (life && life.stamina < life.config.stamina.maximum * 0.1) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    const effort = armorStaminaFactor(this.inventory.wornArmor()) * weaponStaminaFactor(weapon);
    if (life && life.stamina < life.config.stamina.roll * effort) buttons &= ~Buttons.Roll;
    if (life && life.stamina < life.config.stamina.sprintPerSecond * TICK_DT * effort) buttons &= ~Buttons.Sprint;
    const canAffordAttack = !life || life.stamina >= weaponAttackStaminaCost(weapon, life.config.stamina.attack, armorStaminaFactor(this.inventory.wornArmor())) || (weapon === WeaponId.C4 && !c4Throw);
    let yaw = this.shotYaw;
    let pitch = this.shotPitch;
    // Swimming blocks every attack; guns also cannot fire mid-jump.
    // (On a ladder the gun still fires from the hip; aiming needs both feet down.)
    const airborne = !local.state.grounded && !local.state.swimming && !local.state.climbing;
    const isGun = WEAPON_SPECS[weapon as Exclude<WeaponId, 0>]?.kind === 'gun';
    const actionTime = performance.now();
    // Third person: a held trigger brings the gun up (sprint stops below), but the shot leaves
    // only once the bore is on the aim.
    const gunUp = !isGun || this.eyeView || this.firstPerson || (this.localAvatar?.gunReady() ?? true);
    const action = this.weaponCtl.tick(actionTime, weapon, trigger && gunUp, canAffordAttack && !local.dead && !local.state.swimming && local.state.rollTicks === 0 && !(isGun && airborne), this.input.touchEnabled && !this.mouseLook,
      (weapon !== WeaponId.C4 || this.inventory.equippedItemId() === 'c4') && c4Throw);
    if (this.weaponCtl.primed) buttons |= Buttons.Prime;
    // The pin pulled as the grenade comes up; the spoon flies off as it leaves the hand.
    if (this.weaponCtl.primed && !this.wasPrimed) this.sounds?.play('partPinPull', { volume: .8 });
    this.wasPrimed = this.weaponCtl.primed;
    if (this.viewModel) this.viewModel.primed = this.weaponCtl.primed;
    if (this.weaponCtl.blocksSprint(actionTime, weapon, trigger)) buttons &= ~Buttons.Sprint;
    if (action === 'throw' && weapon === WeaponId.C4) buttons |= Buttons.ThrowC4;
    else if (action !== 'none') buttons |= Buttons.Attack;
    // The blade combo's finisher lunges forward on the tick it starts (validated by the server).
    if (action === 'melee' && this.weaponCtl.bladeStep >= 0 && BLADE_COMBO[this.weaponCtl.bladeStep]?.lunge) buttons |= Buttons.Lunge;
    // The quắm's second swing steps in with it (its recording travels about 2 m).
    else if (action === 'melee' && weaponSpec(weapon)?.kind === 'melee' && meleeSwing(weapon, weaponSpec(weapon) as MeleeSpec, this.weaponCtl.meleeSwings - 1)?.clip === LONG_LUNGE_CLIP) buttons |= Buttons.Lunge | Buttons.LungeLong;
    if (this.healing) buttons |= Buttons.Heal;
    const spec = weaponSpec(weapon);
    if (action === 'shot') {
      this.localShot(weapon);
    } else if (action === 'melee' && spec?.kind === 'melee') {
      const variant = this.localAvatar?.slash(this.weaponCtl.bladeStep, this.weaponCtl.meleeSwings - 1) ?? 1;
      // First person keeps the same swing length as the body (long / heavy weapons' recorded swing).
      this.viewModel?.swing(variant, meleeSwing(this.equippedWeapon(), spec, this.weaponCtl.meleeSwings - 1)?.durationMs ?? spec.animationMs);
      this.meleeFeel.swing(variant, spec.animationMs ?? spec.swingMs, spec.weight, performance.now(), EDGED_MELEE_WEAPONS.has(this.equippedWeapon()));
      // The finisher lunges in and cuts through: the screen shakes as its blow lands.
      const step = this.weaponCtl.bladeStep;
      if (BLADE_COMBO_WEAPONS.has(this.equippedWeapon()) && step >= 0 && BLADE_COMBO[step]?.lunge) this.meleeFeel.finisher(performance.now() + bladeStepTiming(spec, step).hitMs);
      const avatar = this.localAvatar;
      if (avatar) this.slashAt(
        () => avatar.root.parent && !local.dead ? { x: avatar.root.position.x, y: avatar.root.position.y, z: avatar.root.position.z, yaw: this.input.yaw } : null,
        weapon, variant, true,
      );
    } else if (action === 'melee' && !spec) {
      // Empty hands: a jab.
      this.viewModel?.punch();
    } else if (action === 'detonate') {
      this.sounds?.play('partDetonator', { volume: .8 });
      this.viewModel?.kick(.15);
    } else if (action === 'throw') {
      this.viewModel?.throw();
      if (weapon !== WeaponId.C4) this.sounds?.play('partSpoon', { volume: .7 });
      // Along the aim like a shot (top-down: pitched to come down on the cursor).
      if (this.throwPlan) ({ yaw, pitch } = this.throwPlan);
      this.localAvatar?.playOnce('grenade_throw');
    }
    const msg = local.step(moveX, moveZ, this.mouseLook ? this.input.yaw : yaw, pitch, buttons, this.clock.now() - INTERPOLATION_DELAY_MS, weapon);
    if (this.mouseLook) msg.aimYaw = yaw;
    this.input.acknowledgeTouchPresses();
    const back = this.backItemId();
    const bw = back ? WEAPON_BY_ITEM[back] : undefined;
    if (bw) msg.bw = bw;
    this.pendingWeaponInputs.push(msg);
  }

  /** The last battle snapshot with its safe circle advanced to now (snapshots arrive at 1 Hz). */
  private liveBattle(): BattleState | null {
    const battle = this.hud.get().battle;
    return battle ? { ...battle, circle: battleCircleAt(battle, performance.now() - this.planeReceivedAt) } : null;
  }

  /** Current daylight as a CSS colour for the minimap (white noon, warm dusk, blue night). */
  private minimapTint(): string {
    const sky = this.sky;
    if (!sky) return '#ffffff';
    const day = 1 - sky.night;
    const lvl = 0.35 + 0.65 * sky.lightLevel;
    const r = (sky.sunColor.r * day + 0.32 * sky.night) * lvl;
    const g = (sky.sunColor.g * day + 0.42 * sky.night) * lvl;
    const b = (sky.sunColor.b * day + 0.78 * sky.night) * lvl;
    // Only a hint of the hour: the grey map must stay readable at night.
    const c = (v: number) => Math.round((0.62 + 0.38 * Math.min(1, Math.max(0, v))) * 255);
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }

  /** The main-slot weapon (heavy, then primary) that is not in hand: carried on the back. */
  private backItemId(): string | null {
    const st = this.inventory.get();
    for (const c of ['heavy', 'primary'] as const) {
      const it = st.items.filter((i) => i.container === c && i.uid !== st.equipped).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (it) return it.itemId;
    }
    return null;
  }

  private equippedWeapon(): number {
    const itemId = this.inventory.equippedItemId();
    return itemId ? (WEAPON_BY_ITEM[itemId] ?? WeaponId.None) : WeaponId.None;
  }

  /**
   * Immediate local muzzle/sound feedback; flying ammunition comes from server launch events.
   */
  private localShot(weapon: number): void {
    const spec = WEAPON_SPECS[weapon as Exclude<WeaponId, 0>];
    const local = this.local;
    if (spec?.kind !== 'gun' || !local) return;
    const attachments = this.inventory.equippedAttachments();
    const kick = weaponRecoil(weapon) * attachmentModifier(attachments, 'recoil') * (this.aiming ? .65 : 1) * (.85 + Math.random() * .3);
    const suppressed = attachmentModifier(attachments, 'flash') === 0;
    this.viewModel?.kick(Math.min(1.8, kick * 28));
    if (this.mouseLook) this.recoil.kick(kick);
    this.shotBloom = Math.min(1, this.shotBloom + .22 + kick * .4);
    const s = local.state;
    const yaw = this.shotYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const ox = s.x;
    const oy = s.y + muzzleHeight(s.prone, !!s.crouched);
    const oz = s.z;
    const ends: number[] = [];
    const heavy = heavyKick(weapon);
    const av = this.localAvatar;
    const dir = new Vector3(fx * Math.cos(this.shotPitch), Math.sin(this.shotPitch), fz * Math.cos(this.shotPitch));
    // Render after this frame's camera and weapon pose, so the flash shares the visible bore.
    this.pendingLocalShots.push(() => {
      const bore = this.localWeaponBore(this.tmpA, dir);
      if (bore) this.towardsAim(this.tmpA, dir);
      const muzzle = bore || this.localWeaponPoint('muzzle', this.tmpA) ? this.tmpA : this.firstPerson
        ? this.tmpA.copy(this.camera.position).addScaledVector(dir, 0.6)
        : this.tmpA.set(ox + fx * 0.6, oy, oz + fz * 0.6);
      const eject = this.localWeaponPoint('eject', this.tmpB) ? this.tmpB : null;
      const id = this.welcome?.playerId ?? 0;
      this.effects?.shot(id, { weapon, muzzle, dir, eject, right: new Vector3(-fz, 0, fx), ends, suppressed, muzzleDevice: attachments?.muzzle });
    });
    av?.kick(heavy ? 0.35 : 0.12);
  }

  /** Alt: the attachment screen for the gun in hand. */
  private openAttachments(): boolean {
    const gun = this.inventory.equippedItem();
    if (!gun || !acceptsAttachments(gun.itemId) || this.local?.dead) return false;
    this.inventory.openAttachments(gun.uid, true);
    return true;
  }

  /** Night-vision mode of a night-vision scope (kept while switching guns). */
  private nightVision = false;
  /** M / mouse wheel while looking through a night-vision scope; false when nothing to switch. */
  toggleNightVision(): boolean {
    if (!this.scoped || !opticOf(this.inventory.equippedAttachments())?.nightVision) return false;
    this.nightVision = !this.nightVision;
    this.sounds?.play('aimIn', { volume: .5, rate: this.nightVision ? 1.4 : 1.1 });
    return true;
  }

  private readonly shotRayObj = new Ray();

  private localWeaponPoint(point: 'muzzle' | 'eject', out: Vector3): boolean {
    if (this.eyeView && (!this.scoped || this.lensScoped)) return this.viewModel?.weaponPoint(point, out) ?? false;
    if (this.firstPerson) return false;
    return this.localAvatar?.weaponPoint(point, out) ?? false;
  }

  /**
   * Third person and top view: from the muzzle straight to the aimed point (the muzzle sits off
   * the body's centre line, so the bore's parallel line would miss the cursor by that offset).
   * Kept to within a few degrees of the gun's own bore; first person already shoots down the sights.
   */
  private towardsAim(muzzle: Vector3, direction: Vector3): void {
    if (!this.aimTargetValid) return;
    // Aiming down the sights or through an optic, the sight picture is the aim: the gun model's
    // bore can tilt away from its sight line (sight heights set in the Studio, mount height,
    // eyepiece fit), so the shot goes from the muzzle to the point under the sights / reticle.
    const optic = (this.scoped || this.aiming) && this.eyeView;
    if (this.eyeView && !optic) return;
    const to = this.tmpD.copy(this.aimTarget).sub(muzzle);
    if (to.lengthSq() < (optic ? .04 : 1)) return;
    to.normalize();
    if (optic || to.dot(direction) > Math.cos(AIM_CORRECTION_MAX)) direction.copy(to);
  }

  private localWeaponBore(origin: Vector3, direction: Vector3): boolean {
    if (this.eyeView && (!this.scoped || this.lensScoped)) return this.viewModel?.weaponBore(origin, direction) ?? false;
    if (this.firstPerson) return false;
    return this.localAvatar?.weaponBore(origin, direction) ?? false;
  }

  /** Distance along a ray to the first creature hitbox before `maxT` (else `maxT`). */
  private bodyHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const ray = this.shotRayObj;
    ray.origin.set(ox, oy, oz);
    ray.direction.set(dx, dy, dz);
    let best = maxT;
    const test = (x: number, y: number, z: number, r: number, h: number) => {
      if ((x - ox) ** 2 + (z - oz) ** 2 > (best + 2) ** 2) return;
      this.hitBox.min.set(x - r, y, z - r);
      this.hitBox.max.set(x + r, y + h, z + r);
      if (!ray.intersectBox(this.hitBox, this.tmpC)) return;
      const d = this.tmpC.distanceTo(ray.origin);
      if (d > 0.3 && d < best) best = d;
    };
    for (const zb of this.zombies.values()) {
      if (zb.entity.pose.flags & EntityFlags.Dead || !zb.avatar.root.visible) continue;
      const q = zb.avatar.root.position;
      const pose = zb.entity.pose;
      const rig = zombieHitRig(zb.variant, zb.limbs, !!(pose.flags & EntityFlags.Grounded));
      const hit = raycastRig(rig, q.x, q.y, q.z, zb.avatar.root.rotation.y, ox, oy, oz, dx, dy, dz, best);
      if (hit && hit.t > .3) best = hit.t;
    }
    for (const r of this.remotes.values()) {
      if (r.entity.pose.flags & EntityFlags.Dead || !r.avatar.root.visible) continue;
      if (this.hud.get().team?.members.some((m) => m.entityId === r.entity.id)) continue;
      const q = r.avatar.root.position;
      if (r.entity.pose.flags & EntityFlags.Prone) {
        const hit = raycastRig(PRONE_RIG, q.x, q.y, q.z, r.avatar.root.rotation.y, ox, oy, oz, dx, dy, dz, best);
        if (hit && hit.t > .3) best = hit.t;
      } else if (r.entity.kind === EntityKind.Animal) test(q.x, q.y, q.z, 0.6, 1.0);
      else test(q.x, q.y, q.z, 0.35, 1.85);
    }
    return best;
  }

  /** Starts applying a first aid kit (5 s); it is used up and heals when the time is up. */
  /** Returns whether first aid actually started. */
  private useMedkit(uid?: number): boolean {
    const local = this.local;
    if (!local || local.dead || this.healing) return false;
    const kit = this.inventory.get().items.find((i) => i.itemId === 'medkit' && (uid === undefined || i.uid === uid));
    if (!kit) {
      this.toast({ key: 'toast.no_medkit' });
      return false;
    }
    if (local.health >= PLAYER_MAX_HEALTH) {
      this.toast({ key: 'toast.full_health' });
      return false;
    }
    this.healing = { uid: kit.uid, start: performance.now() };
    this.sounds?.play('glockReload', { rate: 0.6, volume: 0.5 });
    return true;
  }

  private updateHealing(now: number): void {
    const h = this.healing;
    if (this.localAvatar) this.localAvatar.healing = !!h;
    if (!h) return;
    const kitGone = !this.inventory.get().items.some((i) => i.uid === h.uid);
    // Moving (or rolling/jumping) or taking a hit interrupts first aid; the kit is not used up.
    // Red-zone damage does not, so a kit can be used to outlast the zone.
    const a = this.input.axes();
    const moving = a.mx !== 0 || a.mz !== 0 || (this.input.buttons() & (Buttons.Jump | Buttons.Roll)) !== 0;
    if (this.local?.dead || kitGone || moving || this.healBreakAt > h.start) {
      if (!kitGone && !this.local?.dead) this.toast({ key: 'toast.heal_interrupted' });
      this.healing = null;
      this.hud.set({ healing: null });
      return;
    }
    const p = Math.min(1, (now - h.start) / MEDKIT_USE_MS);
    if (p < 1) {
      if (Math.round(p * 40) !== Math.round((this.hud.get().healing ?? -1) * 40)) this.hud.set({ healing: p });
      return;
    }
    this.healing = null;
    // The server uses up one charge of the kit and heals.
    this.conn.sendHeal(h.uid);
    this.hud.set({ healing: null });
    if (this.effects && this.local) {
      const s = this.local.state;
      for (let i = 0; i < 14; i++) this.effects.particles.glow.emit({ x: s.x + (Math.random() - 0.5) * 0.8, y: s.y + 0.3 + Math.random() * 1.4, z: s.z + (Math.random() - 0.5) * 0.8, vy: 1.2, life: 0.9, size: 0.12, sizeEnd: 0.02, color: [0.45, 1, 0.55], colorEnd: [0.2, 0.8, 0.3], alpha: 0.9 });
    }
  }

  /** A spinning gold ZCoin with a soft glow ring, lying where the zombie fell. */
  private addCoinDrop(id: number, x: number, y: number, z: number, amount: number): void {
    if (this.coinDrops.has(id)) return;
    const g = new Group();
    const model = this.weapons?.get('zcoin')?.display.clone(true);
    if (model) {
      // Bigger piles look bigger.
      model.scale.setScalar(3.5 + Math.min(10, amount) * 0.25);
      model.position.y = 0.35;
      g.add(model);
    }
    const ring = new Mesh(this.coinRingGeometry, this.coinRingMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.coinDrops.set(id, g);
    this.lastStationScan = 0;
  }

  /** Dresses an avatar in a loadout (models load on demand; re-dressed when they arrive). */
  private bucketModel: Promise<Group | null> | null = null;
  /** A zombie's gear: a bucket over the head (zombies wear no armour pieces). */
  private dressZombie(avatar: ZombieAvatar, packed: number): void {
    if (this.disposed) return;
    const loadout = unpackArmor(packed), bucket = loadout.head === ZOMBIE_BUCKET;
    if (bucket) {
      this.bucketModel ??= (this.library.load(CAMP_ASSET['old-iron-bucket']) ?? Promise.resolve(undefined)).then((v) => {
        if (!v) return null;
        const g = new Group();
        for (const part of v.parts) g.add(new Mesh(part.geometry, part.material));
        return g;
      }).catch(() => null);
      void this.bucketModel.then((g) => { if (g && this.zombies.size) avatar.setBucket(g.clone(true)); });
    } else avatar.setBucket(null);
  }

  /** Soldier NPCs' gear (null for everyone else): guards in gas masks, the colonel with a headset. */
  private soldierOutfit(kind: EntityKind, id: number): ArmorLoadout | null {
    const model = kind === EntityKind.QuestNpc ? this.questNpcDefinitions.find((n) => n.id === id)?.model ?? '' : '';
    if (kind === EntityKind.Guard) return { head: id % 2 ? 32 : 31, face: 45, ears: 0, chest: id % 3 ? 63 : 64 };
    if (/soldier/.test(model)) return { head: 33, face: 0, ears: 0, chest: 64 };
    return null;
  }

  private dressAvatar(avatar: Avatar, loadout: ArmorLoadout): void {
    if (this.disposed) return;
    for (const slot of ARMOR_SLOTS) {
      const id = loadout[slot];
      if (!id) {
        avatar.setArmor(slot, null);
        continue;
      }
      const t = requestArmor(id, () => this.dressAvatar(avatar, loadout));
      if (t !== undefined) avatar.setArmor(slot, t);
    }
  }

  /** Worn armour changed: tell the server, slow down by its weight, dress our model and the viewer. */
  /** The inventory's model holds what is in hand and wears what is carried. */
  private syncPreview(): void {
    const st = this.inventory.get();
    this.preview?.setEquipment(this.inventory.equippedItemId(), this.inventory.stance(), carriedGear(st.items, st.equipped), this.weapons, this.inventory.equippedAttachments());
  }

  private syncArmor(): void {
    const loadout = this.inventory.wornArmor();
    const key = ARMOR_SLOTS.map((s) => loadout[s]).join(',');
    if (this.local) this.local.speedMul = (this.selfInfected ? this.infectionRules.zombieSpeed : armorSpeedFactor(loadout) * weaponSpeedFactor(this.equippedWeapon()));
    if (key === this.armorKey) return;
    const first = this.armorKey === '';
    this.armorKey = key;
    if (this.localAvatar) this.dressAvatar(this.localAvatar, loadout);
    this.preview?.setArmor(loadout);
    // What is worn narrows the view (visors, masks) and changes hearing (masks, headsets).
    const vision = armorVision(loadout);
    if (this.vision) this.vision.halfAngle = VISION_HALF_ANGLE * (1 - vision);
    this.hud.set({ visorVision: vision });
    this.sounds?.setHearing(armorHearing(loadout));
    if (!first) this.sounds?.playEquip(ARMOR_SLOTS.some((s) => (ARMOR_BY_ID.get(loadout[s])?.weight ?? 0) >= 3));
  }

  private remoteName(id: number, kind: EntityKind): string {
    if (kind === EntityKind.Animal) return '';
    if (kind === EntityKind.QuestNpc) return this.questNpcDefinitions.find((n) => n.id === id)?.name ?? 'NPC';
    if (kind === EntityKind.Guard) return guardName(id);
    if (kind === EntityKind.Merchant) return MERCHANT_NAME;
    if (kind === EntityKind.Nurse) return NURSE_NAME;
    if (kind === EntityKind.Architect) return ARCHITECT_NAME;
    // Battle royale hides who is who once the match runs: no name tags over other players. In the
    // lobby everyone can see who else came.
    const phase = this.hud.get().battle?.phase;
    if (this.welcome?.mode === 'battle-royale' && phase !== 'waiting' && phase !== 'countdown') return '';
    return this.names.get(id) ?? `#${id}`;
  }

  /** Blade swing visual and sound (local or remote), from the weapon's reach. */
  private slashAt(follow: () => SlashPose | null, weapon: number, variant: number, own = false): void {
    const spec = weaponSpec(weapon);
    if (spec?.kind !== 'melee') return;
    const pose = follow();
    if (!pose) return;
    const reach = spec.animationMs ? spec.range : Math.min(spec.range, 2.8);
    // The cut appears with the blow (blades only): the combo step's or the recorded swing's moment.
    if (EDGED_MELEE_WEAPONS.has(weapon)) {
      const step = own ? this.weaponCtl.bladeStep : -1;
      const swing = meleeSwing(weapon, spec, own ? this.weaponCtl.meleeSwings - 1 : 0);
      const hitMs = BLADE_COMBO_WEAPONS.has(weapon) ? bladeStepTiming(spec, Math.max(0, step)).hitMs : swing ? swing.hitMs : spec.hitDelayMs;
      this.slashes?.spawn(follow, reach * 0.85, variant, hitMs === undefined ? undefined : hitMs / 1000);
    }
    // Our own whoosh comes from the melee feel (pitched by weapon weight).
    if (!own) this.sounds?.play(EDGED_MELEE_WEAPONS.has(weapon) ? 'swordSlash' : 'airSwing', { at: { x: pose.x, y: pose.y + 1.2, z: pose.z }, volume: 0.55, maxDistance: 25, rate: EDGED_MELEE_WEAPONS.has(weapon) ? 1 : 1.15 - Math.min(3, spec.weight / 2) * .15 });
  }

  /* --------------------------------------- shop ------------------------------------------ */

  private buy(item: string): void {
    if (!this.inventory.hasRoomFor(item)) return this.toast({ key: 'toast.inventory_full' });
    const req = this.nextTrade++;
    markPending(`buy:${item}`);
    this.trades.set(req, { buy: item });
    this.conn.sendTrade({ t: 'buy', req, item });
  }

  /** Pay the field medic to be healed to full. */
  private nurseHeal(): void {
    const local = this.local;
    if (!local || local.dead) return;
    if (local.health >= PLAYER_MAX_HEALTH) return this.toast({ key: 'toast.full_health' });
    if (this.hud.get().coins < NURSE_HEAL_PRICE) return this.toast({ key: 'toast.no_funds' });
    const req = this.nextTrade++;
    markPending('nurseheal');
    this.trades.set(req, { heal: true });
    this.conn.sendNurseHeal(req);
  }

  private sell(uid: number): void {
    const it = this.inventory.get().items.find((i) => i.uid === uid);
    if (!it) return;
    if (it.issued) return this.toast({ key: 'toast.not_sellable' });
    const def = ITEMS[it.itemId];
    void def;
    const req = this.nextTrade++;
    markPending(`sell:${uid}`);
    this.trades.set(req, { sellUid: uid });
    this.conn.sendTrade({ t: 'sell', req, uid });
  }

  private onWallet(m: WalletEvent): void {
    clearPending('trade:*');
    // NPC trades have no request id; the server marks successful purchases and sales.
    if (m.req === undefined && m.ok === true) this.sounds?.play('tradeSuccess', { volume: 0.7 });
    this.hud.set({ coins: m.coins });
    if (m.req === undefined) return;
    const trade = this.trades.get(m.req);
    this.trades.delete(m.req);
    if (!trade) return;
    if (trade.buy) clearPending(`buy:${trade.buy}`);
    if (trade.sellUid !== undefined) clearPending(`sell:${trade.sellUid}`);
    if (trade.heal) clearPending('nurseheal');
    if (!m.ok) {
      this.toast({ key: m.reason === 'funds' ? 'toast.no_funds' : m.reason === 'range' ? 'toast.too_far' : m.reason === 'room' ? 'toast.inventory_full' : 'toast.trade_failed' });
      return;
    }
    if (trade.buy || trade.sellUid !== undefined) {
      // Inventory changes arrive separately in the server's 'inv' message.
      this.sounds?.play('tradeSuccess', { volume: 0.7 });
    } else if (trade.heal) {
      this.sounds?.play('glockReload', { rate: 0.6, volume: 0.5 });
      const s = this.local?.state;
      if (s && this.effects) for (let i = 0; i < 14; i++) this.effects.particles.glow.emit({ x: s.x + (Math.random() - 0.5) * 0.8, y: s.y + 0.3 + Math.random() * 1.4, z: s.z + (Math.random() - 0.5) * 0.8, vy: 1.2, life: 0.9, size: 0.12, sizeEnd: 0.02, color: [0.45, 1, 0.55], colorEnd: [0.2, 0.8, 0.3], alpha: 0.9 });
    }
  }

  private renderQuestDrops(entries: HudState['quests']): void {
    this.privateQuestRenderer ??= new BaseLifeRenderer(this.scene);
    // Our quest items lying in the world, each at its exact spot (only we see them).
    const objects = entries.flatMap((q) => q.status === 'active' && q.retrievalModel ? (q.drops ?? []).map((d, i) => ({ id: `${q.id}#${i}`, model: q.retrievalModel!, x: d.x, y: this.groundY(d.x, d.z), z: d.z })) : []);
    void this.privateQuestRenderer.update(objects).catch((err: unknown) => console.error('Private quest model loading failed', err));
  }

  private onOutOfAmmo(weapon: number): void {
    const now = performance.now();
    // The trigger falls on an empty chamber.
    this.sounds?.play('partDryFire', { volume: .7 });
    if (now - this.emptyToastAt < 2000) return;
    this.emptyToastAt = now;
    const box = ammoItemFor(ITEM_BY_WEAPON[weapon] ?? '');
    this.toast(box ? { key: 'toast.out_of_ammo_box', vars: { item: box } } : { key: 'toast.out_of_ammo' });
  }


  /** Is the player next to an ammo cache station? Scanned a few times a second. */
  private scanStations(px: number, pz: number, now: number): void {
    if (now - this.lastStationScan < 200 || !this.store) return;
    this.lastStationScan = now;
    const id = CAMP_ASSET['zion-ammo-cache-station'];
    const camp = this.welcome?.world.camp;
    let near: 'field' | 'camp' | null = null;
    for (const chunk of this.store.chunks.values()) {
      if (chunk.lod !== 0) continue;
      for (const prop of chunk.props) {
        if (prop.asset !== id) continue;
        const t = propTransform(chunk, prop);
        if ((t.x - px) ** 2 + (t.z - pz) ** 2 >= STATION_REACH * STATION_REACH) continue;
        const inCamp = !!camp && Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) <= camp.halfSize + 4;
        near = inCamp ? 'camp' : null;
      }
    }
    this.station = near;
    let merchant = false;
    let nurse = false;
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.Merchant && r.entity.kind !== EntityKind.Nurse) continue;
      const p = r.entity.pose;
      if ((p.x - px) ** 2 + (p.z - pz) ** 2 >= MERCHANT_REACH * MERCHANT_REACH) continue;
      if (r.entity.kind === EntityKind.Merchant) merchant = true;
      else nurse = true;
    }
    this.nearMerchant = merchant;
    this.nearNurse = nurse && !merchant;
    this.nearArchitect = [...this.remotes.values()].some((r) => r.entity.kind === EntityKind.Architect && (r.entity.pose.x - px) ** 2 + (r.entity.pose.z - pz) ** 2 < MERCHANT_REACH * MERCHANT_REACH);
    let talk: { npc: string; name: string } | null = null;
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.QuestNpc) continue;
      const p = r.entity.pose;
      if ((p.x - px) ** 2 + (p.z - pz) ** 2 >= MERCHANT_REACH * MERCHANT_REACH) continue;
      const def = this.questNpcDefinitions.find((n) => n.id === r.entity.id);
      if (def) talk = { npc: def.key, name: def.name };
    }
    const store = this.storagePos();
    this.nearStorage = !!store && Math.hypot(store.x - px, store.z - pz) <= store.radius;
    const life = this.hud.get().life;
    const onPlot = life && !life.action
      ? life.config.plots.map((pl) => life.objects.find((o) => o.id === pl.id)).find((o) => o && !life.plots[o.id] && Math.abs(o.x - px) <= 0.95 && Math.abs(o.z - pz) <= 0.95)?.id ?? null
      : null;
    if (onPlot !== this.hud.get().plot) this.hud.set({ plot: onPlot });
    const open = this.hud.get().dialogue;
    if (open && open.npc !== talk?.npc) this.hud.set({ dialogue: null });
    this.targets = this.collectTargets(px, pz, { talk, merchant, nurse, near });
    // Loose items at our feet: two or more get a list to pick from.
    const items = this.targets.filter((t) => t.kind === 'ground').map((t) => t.ground!);
    const sig = JSON.stringify(items.map((g) => g.id));
    if (sig !== this.groundSig) { this.groundSig = sig; this.hud.set({ groundNear: items.map((g) => ({ id: g.id, itemId: g.itemId, count: g.count })) }); }
  }
  private groundSig = '';

  /** Clear line from our chest to a point (no floor, wall or ceiling in between). */
  private canReach(x: number, y: number, z: number, slack = .75): boolean {
    const s = this.local?.state, col = this.store?.collision;
    if (!s || !col) return false;
    const ey = s.y + 1.1, ty = y + .35, dx = x - s.x, dy = ty - ey, dz = z - s.z, d = Math.hypot(dx, dy, dz);
    if (d < .3) return true;
    if (!col.raycast(s.x, ey, s.z, dx / d, dy / d, dz / d, d, Mask.CharacterMovement, this.reachHit)) return true;
    return this.reachHit.t >= d - slack;
  }

  /**
   * Everything usable within reach, each with what it is called and what using it does. Items,
   * chests and crates count only on the player's own floor with nothing solid in between.
   */
  private collectTargets(px: number, pz: number, near: { talk: { npc: string; name: string } | null; merchant: boolean; nurse: boolean; near: 'field' | 'camp' | null }): Interactable[] {
    const out: Interactable[] = [];
    const local = this.local;
    if (!local || local.dead || this.hud.get().downed !== null || local.state.flight || !this.store) return out;
    const py = local.state.y;
    const lang = settingsStore.get().lang;
    for (const [id, door] of this.doors) {
      if (Math.hypot(door.x - px, door.z - pz) > 2.4 || Math.abs(door.y - py) >= 2) continue;
      out.push({ kind: 'door', x: door.x, y: door.y + 1, z: door.z, radius: .9, label: { key: 'raw', vars: { text: door.open ? 'Đóng cửa' : 'Mở cửa' } }, run: () => this.conn.sendDoor(id) });
    }
    const down = this.downedNear();
    if (down) {
      const p = this.remotes.get(down.id)?.avatar.root.position;
      if (p) out.push({ kind: 'revive', x: p.x, y: p.y + .3, z: p.z, radius: 1, label: { key: 'interact.revive', vars: { item: this.remoteName(down.id, EntityKind.Player) } }, run: () => this.conn.sendRevive(down.id) });
    }
    const life = this.lifeTarget(px, pz);
    if (life) out.push({ kind: 'life', x: px, y: py, z: pz, radius: 1.5, label: life.label, run: () => life.run?.() });
    for (const g of this.groundItems?.items ?? []) {
      if (Math.hypot(g.x - px, g.z - pz) > PICKUP_REACH || Math.abs(g.y - py) > 1.3 || !this.canReach(g.x, g.y, g.z, .3)) continue;
      out.push({ kind: 'ground', ground: g, x: g.x, y: g.y + .1, z: g.z, radius: .6, label: { key: 'interact.pickup', vars: { item: g.itemId } }, run: () => this.pickUp(g.id) });
    }
    if (near.talk) {
      const npc = [...this.remotes.values()].find((r) => r.entity.kind === EntityKind.QuestNpc && this.questNpcDefinitions.find((n) => n.id === r.entity.id)?.key === near.talk!.npc);
      const p = npc?.entity.pose;
      if (p) out.push({ kind: 'talk', x: p.x, y: p.y + 1, z: p.z, radius: 1, label: { key: 'interact.talk', vars: { item: near.talk.name } }, run: () => this.hud.set({ dialogue: near.talk }) });
    }
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.Merchant && r.entity.kind !== EntityKind.Nurse) continue;
      const p = r.entity.pose;
      if (Math.hypot(p.x - px, p.z - pz) >= MERCHANT_REACH) continue;
      const shop = r.entity.kind === EntityKind.Merchant;
      out.push({ kind: shop ? 'shop' : 'nurse', x: p.x, y: p.y + 1, z: p.z, radius: 1, label: { key: shop ? 'interact.shop' : 'interact.nurse' }, run: () => this.inventory.setOpen(true, shop ? 'shop' : 'nurse') });
    }
    // Chests and crates on our floor, in sight.
    if (!this.infection) {
      const camp = this.welcome?.world.camp, cache = CAMP_ASSET['zion-ammo-cache-station'];
      for (const chunk of this.store.chunks.values()) {
        if (chunk.lod !== 0) continue;
        for (const prop of chunk.props) {
          if (!CHEST_ASSETS.has(prop.asset)) continue;
          const t = propTransform(chunk, prop);
          if (Math.hypot(t.x - px, t.z - pz) > CHEST_REACH || Math.abs(t.y - py) > 2.5) continue;
          if (prop.asset === cache && !!camp && Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) <= camp.halfSize + 4) continue;
          if (!this.canReach(t.x, t.y + .2, t.z)) continue;
          const key = chestKey(prop.asset, t.x, t.y, t.z), name = this.registry.byNumericId(prop.asset)?.name;
          out.push({ kind: 'chest', x: t.x, y: t.y + .5, z: t.z, radius: 1, label: { key: 'interact.chest' }, name, run: () => this.inventory.openChest(key) });
        }
      }
      for (const crate of this.deathCrates.values()) {
        if (Math.hypot(crate.x - px, crate.z - pz) > CHEST_REACH || Math.abs(crate.y - py) > 2.5 || !this.canReach(crate.x, crate.y, crate.z)) continue;
        out.push({ kind: 'chest', x: crate.x, y: crate.y + .4, z: crate.z, radius: 1, label: { key: 'interact.chest' }, run: () => this.inventory.openChest(crate.id) });
      }
    }
    const store = this.storagePos();
    if (store && Math.hypot(store.x - px, store.z - pz) <= store.radius && !near.merchant) out.push({ kind: 'storage', x: store.x, y: py + 1, z: store.z, radius: 1.5, label: { key: 'interact.storage' }, run: () => this.inventory.setOpen(true, 'stash') });
    if (near.near) out.push({ kind: 'cache', x: px, y: py + 1, z: pz, radius: 1.5, label: { key: near.near === 'camp' ? 'interact.camp_cache' : 'interact.cache' }, run: () => this.inventory.setOpen(true, near.near) });
    for (const t of this.building?.targets(px, py, pz) ?? []) out.push(t);
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.Architect) continue;
      const p = r.entity.pose;
      if (Math.hypot(p.x - px, p.z - pz) >= MERCHANT_REACH) continue;
      out.push({ kind: 'architect', x: p.x, y: p.y + 1, z: p.z, radius: 1, label: { key: 'raw', vars: { text: 'Nói chuyện với kỹ sư · bản vẽ công trình' } }, run: () => this.inventory.setOpen(true, 'architect') });
    }
    const v = this.vehicles?.nearest(px, py, pz);
    if (v && !local.riding) out.push({ kind: 'vehicle', x: v.x, y: v.y + 1, z: v.z, radius: 2.4, label: { key: 'raw', vars: { text: `Lên ${VEHICLES[v.kind]?.name ?? 'xe'}` } }, run: () => this.conn.sendVehicle(v.id) });
    void lang;
    return out;
  }

  /**
   * Which target is in focus. TOP view: the one under the mouse cursor; third person: under the
   * crosshair (both exactly; nothing in focus means right click aims as usual). First person:
   * under the crosshair, else the nearest (used with F).
   */
  private updateHover(): void {
    const local = this.local;
    let pick: Interactable | null = null;
    if (local && this.targets.length && !this.inventory.get().open) {
      const top = this.cameraMode === 'top-down';
      this.raycaster.setFromCamera(top ? this.ndc.set(this.input.pointer.x, this.input.pointer.y) : this.ndc.set(0, 0), this.camera);
      const ray = this.raycaster.ray;
      let best = Infinity;
      for (const t of this.targets) {
        const d = ray.distanceToPoint(this.tmpA.set(t.x, t.y, t.z));
        const reach = t.radius * (top ? 1.4 : 1);
        if (d <= reach && d < best) { best = d; pick = t; }
      }
      // First person: nothing under the crosshair → the nearest loose item (F picks it up).
      if (!pick && this.firstPerson) pick = this.targets.filter((t) => t.kind === 'ground').sort((a, b) => Math.hypot(a.x - local.state.x, a.z - local.state.z) - Math.hypot(b.x - local.state.x, b.z - local.state.z))[0] ?? null;
    }
    this.hovered = pick;
    const label = pick ? (pick.name && pick.kind === 'chest' ? { key: 'raw', vars: { text: `${this.translate(pick.label)} · ${pick.name}` } } as Msg : pick.label) : null;
    // First person: right click opens chests and doors (and the like); F picks up items and boards vehicles.
    const input: 'mouse' | 'key' = pick && (pick.kind === 'trunk' || (this.firstPerson && (pick.kind === 'ground' || pick.kind === 'vehicle'))) ? 'key' : 'mouse';
    let at: [number, number] | null = null;
    if (pick && this.cameraMode === 'top-down') {
      const p = this.tmpA.set(pick.x, pick.y + .6, pick.z).project(this.camera);
      at = [Math.round((p.x + 1) / 2 * this.container.clientWidth), Math.round((1 - p.y) / 2 * this.container.clientHeight)];
    }
    const sig = JSON.stringify([label, input, at]);
    if (sig !== this.interact) { this.interact = sig; this.hud.set({ interact: label, interactInput: input, interactAt: at }); }
  }

  private translate(m: Msg): string {
    return translateMsg(settingsStore.get().lang, m);
  }

  /** Pick up one loose item (the server checks reach and room). */
  pickUp(id: number): void {
    const g = this.groundItems?.items.find((i) => i.id === id);
    if (!g) return;
    this.inventory.pickUpGround(id);
    this.sounds?.play(weaponSpec(WEAPON_BY_ITEM[g.itemId] ?? 0) ? 'pickupWeapon' : 'pickup', { volume: .7 });
  }

  /** Right click in TOP / third person on something usable: use it (true = the click is taken). */
  private useHovered(): boolean {
    if (!this.hovered || this.inventory.get().open) return false;
    // First person: right click is for chests, doors and the like; items and vehicles are F.
    if (this.firstPerson && (this.hovered.kind === 'ground' || this.hovered.kind === 'vehicle')) return false;
    // Captions only (what a swing does here) and trunks (F) leave right click to aiming.
    if (this.hovered.kind === 'hint' || this.hovered.kind === 'trunk') return false;
    if (this.local?.dead || this.hud.get().downed !== null) return false;
    this.hovered.run();
    return true;
  }

  /** F: quick pick-up of a loose item (the one in focus, else the nearest), otherwise in / out of a vehicle. */
  private onKeyF(): void {
    const local = this.local;
    if (local && !local.riding && !local.dead) {
      const ground = this.hovered?.kind === 'ground' ? this.hovered : this.targets.filter((t) => t.kind === 'ground').sort((a, b) => Math.hypot(a.x - local.state.x, a.z - local.state.z) - Math.hypot(b.x - local.state.x, b.z - local.state.z))[0];
      if (ground) { ground.run(); return; }
      const trunk = this.hovered?.kind === 'trunk' ? this.hovered : this.targets.find((t) => t.kind === 'trunk');
      if (trunk) { trunk.run(); return; }
    }
    this.useVehicle();
  }

  /** E, Tab or I: open the inventory, in every view. */
  private openBag(_key: 'KeyE' | 'other'): void {
    if (!this.local || this.local.dead || this.hud.get().downed !== null || this.local.state.flight) return;
    if (this.hud.get().dialogue) { this.closeDialogue(); return; }
    this.building?.cancelPlanning();
    this.inventory.setOpen(true, this.nearMerchant ? 'shop' : this.nearNurse ? 'nurse' : this.nearArchitect ? 'architect' : this.nearStorage ? 'stash' : this.station);
  }

  /**
   * TOP / third person, aiming: standing at a wall's edge with the way ahead blocked, lean out
   * past the side that is open (kept a moment so it does not flicker).
   */
  private peek(now: number): number {
    const local = this.local, col = this.store?.collision;
    if (!local || !col || !this.aiming || !local.state.grounded || local.state.prone) { this.autoLean.side = 0; return 0; }
    const s = local.state, yaw = this.shotYaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), ey = s.y + 1.45;
    const blocked = (ox: number, oz: number, len: number) => col.raycast(s.x + ox, ey, s.z + oz, fx, 0, fz, len, Mask.CharacterMovement, this.reachHit);
    let side = 0;
    if (blocked(0, 0, 1.1)) {
      const right = !blocked(rx * .6, rz * .6, 1.8), left = !blocked(-rx * .6, -rz * .6, 1.8);
      side = right && (!left || this.autoLean.side >= 0) ? 1 : left ? -1 : 0;
    }
    if (side !== this.autoLean.side) {
      if (side === 0 && now - this.autoLean.at < 250) return this.autoLean.side;
      this.autoLean = { side, at: now };
    }
    return side;
  }

  /** Farming, cooking, livestock loot and private quest pick-ups within reach (in that order). */
  private lifeTarget(x: number, z: number): { label: Msg; run?: () => void } | null {
    const name = (id: string) => itemName(settingsStore.get().lang, id);
    for (const q of this.hud.get().quests) {
      if (q.status !== 'active' || !q.retrievalItem || !q.drops) continue;
      const i = q.drops.findIndex((d) => Math.hypot(d.x - x, d.z - z) <= 2.5);
      if (i >= 0) return { label: { key: 'interact.take', vars: { item: name(q.retrievalItem) } }, run: () => this.quest('retrieve', q.npc, q.id, i) };
    }
    const life = this.hud.get().life;
    if (!life || life.action) return null;
    const range = life.config.interactionRange;
    const near = (o: { x: number; z: number }) => Math.hypot(o.x - x, o.z - z) <= range;
    const loot = life.animalLoot.find(near);
    if (loot) return { label: { key: 'interact.loot', vars: { item: `${loot.quantity}× ${name(loot.item)}` } }, run: () => this.lifeAction('loot', loot.id) };
    // Nearest first: the garden plots touch each other.
    for (const o of life.objects.filter(near).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))) {
      if (life.config.plots.some((p) => p.id === o.id)) {
        const state = life.plots[o.id];
        const crop = life.config.crops.find((c) => c.id === state?.crop);
        if (crop && state) {
          if (state.stage < crop.stages.length - 1) return { label: { key: 'interact.growing', vars: { item: name(crop.item) } } };
          return { label: { key: 'interact.harvest', vars: { item: name(crop.yieldItem) } }, run: () => this.lifeAction('harvest', o.id) };
        }
        continue;
      }
      if ((o.cooking || life.config.stations.some((p) => p.id === o.id)) && (!o.expiresAt || o.expiresAt > Date.now())) {
        const batch = planCooking(life.config, this.inventory.get().items);
        if (batch && (!o.expiresAt || o.expiresAt > Date.now() + batch.durationMs)) return { label: { key: 'interact.cook_all', vars: { n: batch.quantity, seconds: Math.ceil(batch.durationMs / 1000) } }, run: () => this.lifeAction('cook', o.id) };
        return { label: { key: 'interact.need_food', vars: { item: '' } } };
      }
    }
    return null;
  }

  /** Touch "use" button: the target in focus or the nearest one, otherwise the inventory. */
  private onInteract(): void {
    if (!this.local || this.local.dead || this.hud.get().downed !== null) return;
    if (this.local.state.flight) return;
    if (this.hud.get().dialogue) { this.closeDialogue(); return; }
    const s = this.local.state;
    const t = this.hovered ?? [...this.targets].sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
    if (t) { t.run(); return; }
    this.openBag('other');
  }

  /** The server's copy of our inventory: show it and adopt its magazine counts. */
  private onInventory(m: { items: Array<{ uid: number; itemId: string; container: string; x: number; y: number; rotated: boolean; count?: number; mag?: number; issued?: boolean }>; equipped: number | null; cacheLeft?: number }): void {
    clearPending('cache:*');
    clearPending('trade:*');
    this.inventory.applyServer(m.items as PlacedItem[], m.equipped, m.cacheLeft);
    for (const it of m.items) {
      const w = WEAPON_BY_ITEM[it.itemId];
      if (w && it.mag !== undefined) this.weaponCtl.syncMag(w, it.mag);
    }
  }

  /** Dashed aim line from the muzzle along the barrel to the first wall (only we see it). */
  private updateLaser(px: number, py: number, pz: number): void {
    if (!this.scoped || this.mouseLook) {
      if (this.laser) this.laser.visible = false;
      return;
    }
    if (!this.laser) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
      this.laser = new Line(geo, new LineDashedMaterial({ color: 0xff3020, dashSize: 0.9, gapSize: 0.55, transparent: true, opacity: 0.85, depthWrite: false }));
      this.laser.frustumCulled = false;
      this.laser.renderOrder = 6;
      this.scene.add(this.laser);
    }
    const spec = weaponSpec(this.equippedWeapon());
    const range = spec?.kind === 'gun' ? spec.range : 120;
    const yaw = this.input.yaw;
    const p = this.input.pitch;
    const direction = this.tmpB.set(-Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p));
    const o = this.localWeaponBore(this.tmpA, direction) ? this.tmpA : this.tmpA.set(px, py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched), pz);
    const { x: dx, y: dy, z: dz } = direction;
    let t = range;
    if (this.store?.collision.raycast(o.x, o.y, o.z, dx, dy, dz, range, Mask.Weapon, this.shotRay)) t = this.shotRay.t;
    const pos = this.laser.geometry.getAttribute('position') as Float32BufferAttribute;
    pos.setXYZ(0, o.x, o.y, o.z);
    pos.setXYZ(1, o.x + dx * t, o.y + dy * t, o.z + dz * t);
    pos.needsUpdate = true;
    this.laser.computeLineDistances();
    this.laser.visible = true;
  }

  private wasPrimed = false;
  private reloadTimers: number[] = [];
  private stopReloadSounds(): void { for (const t of this.reloadTimers) window.clearTimeout(t); this.reloadTimers = []; }

  private onReload(weapon: number, ms: number): void {
    this.conn.sendReload();
    const local = this.local;
    const at = local ? { x: local.state.x, y: local.state.y + 1.2, z: local.state.z } : undefined;
    // Each part heard as it moves (the gun's reload script), else the gun's whole reload sound.
    this.stopReloadSounds();
    // A Hand Studio animation with its own sounds plays them; else the gun's reload script's.
    const anim = handAnimationFor(ITEM_BY_WEAPON[weapon]);
    const script = anim?.sounds.length ? { sounds: anim.sounds.map((e) => ({ at: e.at, sound: e.sound as PartSound, volume: e.volume, rate: e.rate })) } : reloadScriptOf(ITEM_BY_WEAPON[weapon]);
    if (script) {
      for (const step of script.sounds) this.reloadTimers.push(window.setTimeout(() => {
        const p = this.local?.state;
        this.sounds?.play(step.sound, { at: p ? { x: p.x, y: p.y + 1.2, z: p.z } : at, rate: step.rate, volume: step.volume ?? .9, maxDistance: 35 });
      }, step.at * ms));
    } else {
      const [sound, rate] = reloadSound(weapon);
      this.sounds?.play(sound, { at, rate });
    }
    const visual = this.weapons?.get(ITEM_BY_WEAPON[weapon] ?? '');
    if (visual?.reloadClip) this.localAvatar?.playWeaponAnim(visual.reloadClip, ms / 1000);
    this.localAvatar?.startReload(ms / 1000);
    this.viewModel?.reload(ms / 1000);
  }

  private updateAmmoHud(now: number): void {
    const view = this.weaponCtl.view(now, this.equippedWeapon());
    this.viewModel?.setLoaded(!view || view.mag > 0);
    const key = view ? `${view.mag}/${view.max}/${view.reserve}/${view.reload === null ? '' : Math.round(view.reload * 20)}` : '';
    if (key === this.lastAmmoKey) return;
    this.lastAmmoKey = key;
    this.hud.set({ ammo: view });
  }

  /** Throw / launch aim this frame: the yaw and pitch the server launches along (null: none). */
  private throwPlan: { yaw: number; pitch: number } | null = null;
  private throwMarker: Group | null = null;
  private throwArc: ThrowArc | null = null;

  /**
   * Grenades (once the pin is pulled), C4 and grenade launchers: the faint flight path from the
   * hand / muzzle along the aim (the server's own launch: aim direction, speed and drop), dashes
   * drifting forward, and a thin ring where it comes down.
   */
  private updateThrowMarker(px: number, py: number, pz: number): void {
    const spec = weaponSpec(this.equippedWeapon());
    const item = this.inventory.equippedItemId();
    const throwable = spec?.kind === 'throw' && item !== 'c4_detonator';
    const launcher = spec?.kind === 'gun' && !!spec.projectile?.lob;
    const ready = this.input.locked && !this.input.suspended && !this.local?.dead;
    this.throwPlan = null;
    if (!ready || !(launcher || (throwable && (this.weaponCtl.primed || item === 'c4')))) {
      if (this.throwMarker) this.throwMarker.visible = false;
      if (this.throwArc) this.throwArc.mesh.visible = false;
      return;
    }
    const prone = !!this.local?.state.prone, crouched = !!this.local?.state.crouched;
    const groundAt = (x: number, z: number) => { const h = this.store?.collision.terrainHeight(x, z) ?? Number.NaN; return Number.isFinite(h) ? h : py; };
    let launch: ArcLaunch;
    if (spec?.kind === 'throw') {
      const speed = aimedThrowSpeed(spec);
      const oy = py + (prone ? muzzleHeight(true) : 1.6);
      let yaw = this.shotYaw, pitch = this.shotPitch;
      if (!this.mouseLook) {
        // Top-down: thrown towards the cursor, pitched so it comes down on it.
        const dx = this.aimPoint.x - px, dz = this.aimPoint.z - pz;
        if (Math.hypot(dx, dz) > .3) yaw = Math.atan2(-dx, -dz);
        pitch = elevationFor(speed, Math.max(0, Math.hypot(dx, dz) - .4), groundAt(this.aimPoint.x, this.aimPoint.z) - oy);
      }
      this.throwPlan = { yaw, pitch };
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      launch = { origin: this.tmpB.set(px + fx * .4, oy, pz + fz * .4), dirX: fx, dirZ: fz, elevation: pitch, gravity: GRENADE_GRAVITY, groundY: py, speed };
    } else {
      const proj = spec?.kind === 'gun' ? spec.projectile : undefined;
      if (!proj) return;
      const yaw = this.shotYaw, pitch = this.shotPitch, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      launch = { origin: this.tmpB.set(px + fx * .7, py + muzzleHeight(prone, crouched), pz + fz * .7), dirX: fx, dirZ: fz, elevation: pitch, gravity: proj.gravity, groundY: py, speed: proj.speed };
      // From the muzzle along the bore, as the round will leave (see the shot input).
      if (this.localWeaponBore(this.tmpA, this.tmpC)) {
        this.towardsAim(this.tmpA, this.tmpC);
        launch.origin.copy(this.tmpA);
        const horizontal = Math.hypot(this.tmpC.x, this.tmpC.z);
        if (horizontal > 1e-6) { launch.dirX = this.tmpC.x / horizontal; launch.dirZ = this.tmpC.z / horizontal; }
        launch.elevation = Math.atan2(this.tmpC.y, horizontal);
      }
    }
    // Ends where it meets the ground (refined against the terrain under the landing point).
    for (let i = 0; i < 3; i++) launch.groundY = groundAt(ThrowArc.landing(launch, this.tmpA).x, this.tmpA.z);
    ThrowArc.landing(launch, this.tmpA);
    if (!this.throwMarker) {
      const m = new Group();
      const mat = { color: 0xfff4e0, transparent: true, depthWrite: false };
      const fill = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ ...mat, opacity: 0.06 }));
      const edge = new Mesh(new RingGeometry(0.94, 1, 48), new MeshBasicMaterial({ ...mat, opacity: 0.3 }));
      for (const o of [fill, edge]) {
        o.rotation.x = -Math.PI / 2;
        o.renderOrder = 5;
        m.add(o);
      }
      this.scene.add(m);
      this.throwMarker = m;
    }
    this.throwMarker.visible = true;
    this.throwMarker.position.set(this.tmpA.x, launch.groundY + .06, this.tmpA.z);
    this.throwMarker.scale.setScalar(LAUNCHER_MARKER_RADIUS);
    if (!this.throwArc) { this.throwArc = new ThrowArc(); this.scene.add(this.throwArc.mesh); }
    this.throwArc.update(launch, this.camera, this.elapsed);
  }

  /** Turns the free cursor into an aim point on the ground; the character faces it. */
  private updateAim(px: number, py: number, pz: number): void {
    this.updateAimInner(px, py, pz);
    this.updateThrowMarker(px, py, pz);
  }

  private updateShoulderAim(px: number, py: number, pz: number): void {
    if (!this.mouseLook) return;
    this.camera.rotation.set(this.input.pitch, this.input.yaw, this.camera.rotation.z, 'YXZ');
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc.set(0, 0), this.camera);
    const ray = this.raycaster.ray;
    let distance = 100;
    if (this.store?.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance, Mask.Weapon, this.shotRay)) distance = this.shotRay.t;
    distance = this.bodyHit(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance);
    this.tmpA.set(px, py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched), pz);
    this.shoulderAim = reticleAim(this.tmpA, ray, distance);
    this.aimTarget.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
    this.aimTargetValid = true;
  }

  private updateAimInner(px: number, py: number, pz: number): void {
    if (!this.input.locked || this.input.suspended || this.local?.dead) return;
    if (this.mouseLook) {
      // Mouse look sets yaw/pitch directly; no aim assist. The aim point (grenades, launchers) is
      // where the view centre meets the ground plane, or far ahead when looking up.
      this.raycaster.setFromCamera(this.ndc.set(0, 0), this.camera);
      this.aimPlane.constant = -py;
      if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint) || this.aimPoint.distanceToSquared(this.camera.position) > 60 * 60) {
        this.aimPoint.copy(this.raycaster.ray.direction).multiplyScalar(60).add(this.camera.position);
      }
      return;
    }
    if (this.input.touchEnabled) {
      const heading = this.input.touchFacing(CAM_YAW);
      this.input.touchHeading = heading;
      this.input.yaw = heading;
      this.input.pitch = 0;
      if (!this.input.touchFireActive) {
        this.aimPoint.set(px - Math.sin(heading) * 30, py, pz - Math.cos(heading) * 30);
        return;
      }
      const spec = weaponSpec(this.equippedWeapon());
      const range = spec?.kind === 'gun' ? Math.min(60, spec.range) : 0;
      let bestScore = Infinity;
      let found = false;
      for (const zb of this.zombies.values()) {
        if (!zb.avatar.root.visible || zb.entity.pose.flags & EntityFlags.Dead) continue;
        const p = zb.avatar.root.position;
        const dx = p.x - px, dz = p.z - pz, distance = Math.hypot(dx, dz);
        const score = mobileAimScore(dx, dz, heading, range);
        if (score >= bestScore) continue;
        const pose = zb.entity.pose;
        zombieAimPoint((zb.variant << 4) | zb.limbs, pose.flags, p, zb.avatar.root.rotation.y, 'torso', this.tmpB);
        const ty = this.tmpB.y;
        const dy = ty - (py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched)), length = Math.hypot(distance, dy);
        if (this.store?.collision.raycast(px, py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched), pz, dx / length, dy / length, dz / length, length, Mask.LineOfSight, this.shotRay)) continue;
        bestScore = score; found = true;
        this.hoverPoint.copy(this.tmpB);
      }
      if (found) {
        const dx = this.hoverPoint.x - px, dz = this.hoverPoint.z - pz;
        this.input.yaw = Math.atan2(-dx, -dz);
        this.input.pitch = Math.atan2(this.hoverPoint.y - (py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched)), Math.hypot(dx, dz));
        this.aimPoint.copy(this.hoverPoint);
      } else {
        this.aimPoint.set(px - Math.sin(heading) * 30, py, pz - Math.cos(heading) * 30);
      }
      return;
    }
    this.ndc.set(this.input.pointer.x, this.input.pointer.y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.aimPlane.constant = -(py + 1.0);
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint)) return;
    const dx = this.aimPoint.x - px;
    const dz = this.aimPoint.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.09) return;
    // Cursor over a zombie's hitbox: aim straight at the hovered point on its body.
    const target = this.hoveredZombie(px, pz);
    if (target) {
      const tx = target.x - px;
      const tz = target.z - pz;
      const h = Math.hypot(tx, tz);
      if (h > 0.5) {
        this.input.yaw = Math.atan2(-tx, -tz);
        this.input.pitch = Math.atan2(target.y - (py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched)), h);
        this.aimTarget.set(target.x, target.y, target.z); this.aimTargetValid = true;
        return;
      }
    }
    this.input.yaw = Math.atan2(-dx, -dz);
    // Scoped: a flat shot at torso height so long range shots don't sail over targets.
    let pitch = this.scoped || this.local?.state.prone ? Math.atan2(this.aimPoint.y - (py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched)), Math.sqrt(d2)) : aimPitch(Math.sqrt(d2));
    // Scoped bows/launchers: hold over for the round's drop so it comes down on the cursor.
    const spec = weaponSpec(this.equippedWeapon());
    const proj = spec?.kind === 'gun' ? spec.projectile : undefined;
    if (this.scoped && proj && !proj.lob && proj.gravity > 0) pitch += Math.atan((proj.gravity * Math.sqrt(d2)) / (2 * proj.speed * proj.speed));
    this.input.pitch = pitch;
    // The aimed point: along that line from the body's centre, as far as the cursor.
    const reach = Math.sqrt(d2) / Math.max(.2, Math.cos(pitch)), oy = py + muzzleHeight(this.local?.state.prone, !!this.local?.state.crouched);
    this.aimTarget.set(px - Math.sin(this.input.yaw) * Math.cos(pitch) * reach, oy + Math.sin(pitch) * reach, pz - Math.cos(this.input.yaw) * Math.cos(pitch) * reach);
    this.aimTargetValid = !proj?.lob;
  }

  private readonly hitBox = new Box3();
  private readonly hoverPoint = new Vector3();

  /** Nearest visible, living zombie or animal whose hitbox the cursor ray crosses (point on its body axis). */
  private hoveredZombie(px: number, pz: number): Vector3 | null {
    const ray = this.raycaster.ray;
    let best = Infinity;
    let found = false;
    for (const zb of this.zombies.values()) {
      const pose = zb.entity.pose;
      if (!zb.avatar.root.visible || pose.flags & EntityFlags.Dead) continue;
      const zp = zb.avatar.root.position;
      if ((zp.x - px) ** 2 + (zp.z - pz) ** 2 > 60 * 60) continue;
      const rig = zombieHitRig(zb.variant, zb.limbs, !!(pose.flags & EntityFlags.Grounded));
      const hit = raycastRig(rig, zp.x, zp.y, zp.z, zb.avatar.root.rotation.y,
        ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, 150);
      if (!hit) continue;
      const d = hit.t * hit.t;
      if (d >= best) continue;
      best = d;
      found = true;
      // Aim inside the selected capsule, including head/limbs offset from the root when crawling.
      zombieAimPoint((zb.variant << 4) | zb.limbs, pose.flags, zp, zb.avatar.root.rotation.y, hit.zone, this.hoverPoint);
    }
    // Livestock: a low, wide box; aim at the middle of the body.
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.Animal || !r.avatar.root.visible || r.entity.pose.flags & EntityFlags.Dead) continue;
      const ap = r.avatar.root.position;
      if ((ap.x - px) ** 2 + (ap.z - pz) ** 2 > 60 * 60) continue;
      this.hitBox.min.set(ap.x - 0.7, ap.y, ap.z - 0.7);
      this.hitBox.max.set(ap.x + 0.7, ap.y + 1.1, ap.z + 0.7);
      if (!ray.intersectBox(this.hitBox, this.tmpB)) continue;
      const d = this.tmpB.distanceToSquared(ray.origin);
      if (d >= best) continue;
      best = d;
      found = true;
      this.hoverPoint.set(ap.x, ap.y + 0.5, ap.z);
    }
    return found ? this.hoverPoint : null;
  }

  /** Applies camera mode, mouse capture, visibility and lens settings. */
  private graphicsKey = '';
  /** Applies the graphics settings when they change (resolution, shadows, distances, grass). */
  private applyGraphics(settings: ReturnType<typeof settingsStore.get>): void {
    const key = `${settings.renderScale}:${settings.shadows}:${settings.drawDistance}:${settings.grassDensity}:${settings.shaders}:${settings.groundDetail}:${!!this.sky}:${!!this.props}:${!!this.vegetation}`;
    if (key === this.graphicsKey || !this.renderer?.shadowMap) return;
    const shadowsBefore = this.renderer.shadowMap.enabled;
    this.graphicsKey = key;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75) * settings.renderScale);
    const shadows = settings.shadows !== 'off';
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = settings.shadows === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    if (this.sky) {
      // Shaders on: a finer shadow map with soft, wide penumbrae.
      const light = this.sky.light, size = settings.shaders && shadows ? 4096 : settings.shadows === 'high' ? 2048 : 1024;
      light.castShadow = shadows;
      light.shadow.radius = settings.shaders ? 4 : 1;
      light.shadow.blurSamples = settings.shaders ? 16 : 8;
      if (light.shadow.mapSize.x !== size) { light.shadow.mapSize.set(size, size); light.shadow.map?.dispose(); light.shadow.map = null; }
    }
    // Switching shadows on or off changes every lit shader.
    if (shadowsBefore !== shadows) this.scene.traverse((o) => { const m = (o as { material?: { needsUpdate: boolean } | Array<{ needsUpdate: boolean }> }).material; if (Array.isArray(m)) m.forEach(x => { x.needsUpdate = true; }); else if (m) m.needsUpdate = true; });
    if (!settings.shaders && this.shaderPack) { this.shaderPack.dispose(); this.shaderPack = null; }
    this.groundTextures.setDetail(settings.groundDetail, this.renderer);
    this.props?.setDistanceScale(settings.drawDistance);
    this.vegetation?.setQuality(settings.grassDensity, settings.grassDensity < .35 ? 1 : 2);
  }

  private applyViewMode(): void {
    const settings = settingsStore.get();
    this.applyGraphics(settings);
    this.input.setTouchEnabled(settings.touchControls);
    this.renderer.toneMappingExposure = settings.brightness;
    // Spectating always uses the shoulder camera: the mouse orbits around the watched teammate.
    const mode = (this.local?.riding && !this.passenger) || (this.local?.dead && this.hud.get().spectating) ? 'third-person' : settings.cameraMode;
    const fp = mode === 'first-person';
    const mouseLook = mode !== 'top-down';
    this.input.sensitivity = settings.mouseSens * 0.00004;
    const hud = this.hud.get();
    // Spectating keeps the mouse captured so it can orbit the camera around the teammate.
    this.input.freeCursor = mouseLook && ((!!this.local?.dead && !hud.spectating) || !!hud.dialogue || hud.downed !== null);
    this.vision?.setOverlay(!mouseLook);
    if (mode === this.cameraMode) return;
    this.targetVisibility.clear();
    const wasMouseLook = this.mouseLook;
    this.cameraMode = mode;
    this.recoil.reset();
    this.input.setMouseLook(mouseLook);
    if (!wasMouseLook || !mouseLook) this.input.pitch = mode === 'third-person' ? -.12 : 0;
    this.thirdPersonCamera.reset();
    this.shoulderAim = { yaw: this.input.yaw, pitch: this.input.pitch };
    // The held gun in front of the eye: first person, and the shoulder camera's scoped view.
    if (mouseLook && !this.viewModel) {
      // The camera must be in the scene for its children (the held weapon) to render.
      if (!this.camera.parent) this.scene.add(this.camera);
      this.viewModel = new ViewModel(this.camera);
      // The old magazine let fall in a reload (a copy, physical: it drops and lies on the ground).
      this.viewModel.onMagazineDrop = (magazine) => this.effects?.brass.dropMagazine(magazine);
      // The survivor's own skinned hands; the block character lends its arms instead.
      if (this.character?.human) this.viewModel.setBody(this.character.human, this.look);
      else this.viewModel.setSwimArms(this.character?.root.getObjectByName('arm_left') ?? null, this.character?.root.getObjectByName('arm_right') ?? null);
    }
    if (this.localAvatar) this.localAvatar.root.visible = true;
    this.camera.fov = mouseLook ? FP_FOV : 40;
    // First person: a near plane close enough that the aimed gun (and a scope lens right at the eye) is not cut open.
    this.camera.near = fp ? 0.015 : mouseLook ? 0.05 : 0.5;
    this.camera.updateProjectionMatrix();
    this.camFocusInit = false;
  }

  /**
   * Battle royale, eliminated: follow a living squadmate from behind (their body when streamed in,
   * else their reported position). False when there is nobody to watch.
   */
  /** Battle royale, eliminated: the living squadmate being watched (their body when streamed in). */
  private spectateTarget(): { name: string; killer?: boolean; x: number; y: number; z: number } | null {
    if (!this.local?.dead || this.welcome?.mode !== 'battle-royale') return null;
    const mate = (this.hud.get().team?.members ?? []).find((m) => m.entityId !== undefined && m.entityId !== this.welcome?.playerId && m.inGame && (m.health ?? 0) > 0 && m.x !== undefined);
    if (!mate) {
      // Solo: the camera follows whoever killed us, while they live.
      const killer = this.killerId !== null ? this.remotes.get(this.killerId) : undefined;
      if (!killer || (killer.entity.pose.flags & EntityFlags.Dead) || killer.entity.pose.health <= 0) return null;
      const name = this.names.get(this.killerId!) ?? 'Đối thủ';
      return { name, killer: true, x: killer.entity.pose.x, y: killer.entity.pose.y, z: killer.entity.pose.z };
    }
    const body = this.remotes.get(mate.entityId!);
    const x = body ? body.entity.pose.x : mate.x!, z = body ? body.entity.pose.z : mate.z!;
    const y = body ? body.entity.pose.y : mate.y ?? this.groundY(x, z);
    return { name: mate.name, x, y, z };
  }

  /**
   * Follow the watched squadmate from behind. The mouse orbits the camera (our own yaw/pitch), so
   * the spectator can look around them. False when there is nobody to watch.
   */
  private spectate(dt: number): boolean {
    const target = this.spectateTarget();
    if (target) {
      const { x, y, z } = target;
      const f = this.camFocus, k = this.camFocusInit && (f.x - x) ** 2 + (f.z - z) ** 2 < 400 ? 1 - Math.exp(-dt * 10) : 1;
      f.lerp(this.focus.set(x, y + 1.6, z), k); this.camFocusInit = true;
      const pitch = Math.max(-.9, Math.min(.5, this.input.pitch - .18));
      this.thirdPersonCamera.update(this.camera, f, this.input.yaw, pitch, dt, this.store?.collision, false);
    }
    const watching = target?.name ?? null, killer = !!target?.killer;
    if (this.hud.get().spectating !== watching || this.hud.get().spectatingKiller !== killer) this.hud.set({ spectating: watching, spectatingKiller: killer });
    return watching !== null;
  }

  private updateCamera(px: number, py: number, pz: number, dt: number): void {
    if (this.local?.state.flight) {
      this.flightCamera = true;
      const yaw = this.input.yaw, boarding = this.local.state.flight === 1;
      const distance = boarding ? 65 : 9;
      this.camera.position.set(px + Math.sin(yaw) * distance, py + (boarding ? 22 : 4), pz + Math.cos(yaw) * distance);
      this.camera.lookAt(px, py + (boarding ? 0 : .6), pz);
      this.camera.fov = 78; this.camera.updateProjectionMatrix();
      return;
    }
    if (this.flightCamera) {
      this.flightCamera = false; this.camFocusInit = false; this.thirdPersonCamera.reset();
      this.camera.fov = this.mouseLook ? FP_FOV : 40; this.camera.updateProjectionMatrix();
    }
    // A non-finite position (bad snapshot) would blank the whole view: hold the last camera.
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    const cam = this.camera;
    const vehicle = this.local?.riding && !this.passenger && this.welcome ? this.vehicles?.rider(this.welcome.playerId) : undefined;
    if (vehicle) {
      // Centre the chase camera above the roof; the vehicle's own body never blocks it.
      const f = this.camFocus, height = VEHICLES[vehicle.kind].height + .6;
      const k = this.camFocusInit ? 1 - Math.exp(-dt * 18) : 1;
      f.lerp(this.focus.set(vehicle.x, vehicle.y + height, vehicle.z), k);
      this.camFocusInit = true;
      this.vehicles!.withoutOwnColliders(vehicle, () => this.vehicleCamera.update(cam, f, this.input.yaw, Math.max(-.6, Math.min(.2, this.input.pitch)), dt, this.store?.collision, false,
        { distance: 6 + Math.min(2, Math.abs(vehicle.speed) / 17), height: 1 }));
      const fov = 70 + Math.min(8, Math.abs(vehicle.speed) / 4);
      if (Math.abs(cam.fov-fov) > .01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      this.input.lookScale = 1;
      occlusionUniforms.uFadeCam.value.copy(cam.position);
      occlusionUniforms.uFadeTarget.value.set(0, -1e5, 0);
      this.props?.updateOcclusion(1e9, -1e5, 1e9, cam.position.x, cam.position.y, cam.position.z, dt);
      return;
    }
    if (this.mouseLook) {
      // Smooth the eye: prediction corrections and step-ups would otherwise jolt the whole view.
      const eye = py + (this.local?.riding ? 1.32 : this.local ? characterEyeHeight(this.local.state) : DEFAULT_CHARACTER.eyeHeight);
      const f = this.camFocus;
      if (!this.camFocusInit || (f.x - px) ** 2 + (f.z - pz) ** 2 > 25) {
        f.set(px, eye, pz);
        this.camFocusInit = true;
      } else {
        const kh = 1 - Math.exp(-dt * 30);
        const kv = 1 - Math.exp(-dt * 12);
        f.x += (px - f.x) * kh;
        f.z += (pz - f.z) * kh;
        f.y += (eye - f.y) * kv;
      }
      this.scopeZoom += ((this.aiming ? 1 : 0) - this.scopeZoom) * (1 - Math.exp(-dt * SCOPE_PAN_RATE * 2));
      const spec = weaponSpec(this.equippedWeapon());
      // The optic's own power; iron sights and red dots get a slight focus zoom.
      const opticPower = this.currentOptic()?.magnification ?? 1;
      const magnification = spec?.kind === 'gun' ? opticPower > 1 ? opticPower : this.eyeView ? 1.25 : 1.35 : 1;
      const zoom = 1 + (magnification - 1) * this.scopeZoom;
      // Through a lens optic the world outside the lens stays at the normal field of view; only the
      // lens is magnified (ScopeLens), but aim sensitivity still follows the optic's power.
      const viewZoom = opticPower > 1 && this.lensScopeReady() ? 1 : zoom;
      const fov = scopeFov(FP_FOV, viewZoom) + this.feel.fov;
      // The shoulder camera at the eye behind a scope lens needs the first-person near plane.
      const near = this.eyeView ? .015 : .05;
      if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
      this.input.lookScale = 1 / zoom;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      // Eye slightly ahead of the head so the near plane never clips the face/hat.
      // Lean: the eye slides out to the side (never through the wall leant against) and the view tilts.
      const leanTarget = this.local && !this.local.dead ? leanOf(this.local.lastButtons) : 0;
      this.leanBlend += (leanTarget - this.leanBlend) * (1 - Math.exp(-dt * 10));
      const leaned = this.leanFocus.copy(f);
      if (Math.abs(this.leanBlend) > .001) {
        const [lx, lz] = leanOffset(this.input.yaw, this.leanBlend), d = Math.hypot(lx, lz);
        const t = this.store?.collision.raycast(f.x, f.y, f.z, lx / d, 0, lz / d, d + .2, Mask.LineOfSight, this.shotRay) ? Math.max(0, this.shotRay.t - .2) : d;
        leaned.x += lx / d * t; leaned.z += lz / d * t; leaned.y -= Math.abs(this.leanBlend) * .06;
      }
      if (this.cameraMode === 'third-person' && !this.eyeView) {
        const ride = this.passenger ? this.vehicles?.rider(this.welcome!.playerId) : undefined;
        if (ride) this.vehicles!.withoutOwnColliders(ride, () => this.thirdPersonCamera.update(cam, leaned, this.input.yaw, this.input.pitch, dt, this.store?.collision, this.aiming));
        else this.thirdPersonCamera.update(cam, leaned, this.input.yaw, this.input.pitch, dt, this.store?.collision, this.aiming);
        if (this.leanBlend) cam.rotateZ(-this.leanBlend * .08);
        // Melee: the shoulder camera leans into the swing, punches in on a hit and shakes.
        const feel = this.feel;
        if (feel.yaw || feel.pitch || feel.roll || feel.push || feel.shake) {
          cam.position.lerp(leaned, Math.min(.25, feel.push * .35));
          cam.rotateY(feel.yaw * .7); cam.rotateX(feel.pitch * .7); cam.rotateZ(feel.roll * .8);
          if (feel.shake) cam.position.add(this.focus.set((Math.random() - .5) * feel.shake, (Math.random() - .5) * feel.shake, (Math.random() - .5) * feel.shake));
        }
      } else {
        cam.position.set(leaned.x - Math.sin(this.input.yaw) * 0.12, leaned.y, leaned.z - Math.cos(this.input.yaw) * 0.12);
        const shake = (this.effects?.shake ?? 0) * 0.25;
        if (shake > 0) cam.position.add(this.focus.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
        cam.rotation.set(this.input.pitch + this.feel.pitch, this.input.yaw + this.feel.yaw, -this.leanBlend * .2 + this.feel.roll, 'YXZ');
        // First person: the head bobs in step with the run (steadied while aiming).
        if (this.firstPerson && this.viewModel) {
          const b = this.viewModel.headBob;
          cam.position.y += b.y; cam.translateX(b.x); cam.rotateZ(b.roll);
        }
        if (this.feel.shake) cam.position.add(this.focus.set((Math.random() - .5) * this.feel.shake * .6, (Math.random() - .5) * this.feel.shake * .6, (Math.random() - .5) * this.feel.shake * .6));
        if (this.firstPerson && this.local && !this.local.dead && this.hud.get().downed === null) {
          const rolling=this.local.state.rollTicks>0;
          const alongLook=Math.abs(Math.cos(this.local.state.rollYaw-this.input.yaw))>.65;
          if(!(rolling&&alongLook&&this.localAvatar?.rollCamera(cam)))
            applyFirstPersonRoll(cam, this.local.state, this.local.prev.rollTicks, this.accumulator / TICK_DT);
        }
      }
      // Nothing is see-through in first person: park the fade target far below the world and let
      // every faded prop ease back to solid.
      occlusionUniforms.uFadeCam.value.copy(cam.position);
      occlusionUniforms.uFadeTarget.value.set(0, -1e5, 0);
      this.props?.updateOcclusion(1e9, -1e5, 1e9, cam.position.x, cam.position.y, cam.position.z, dt);
      return;
    }
    this.input.lookScale = 1;
    const ty = py + 1.0;
    const f = this.camFocus;
    // Smooth follow; snap on first frame and on teleports/respawns.
    if (!this.camFocusInit || (f.x - px) ** 2 + (f.z - pz) ** 2 > 100) {
      f.set(px, ty, pz);
      this.camFocusInit = true;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      f.x += (px - f.x) * k;
      f.y += (ty - f.y) * k;
      f.z += (pz - f.z) * k;
    }
    // Sniper scope: ease the view towards the cursor (gently, so small mouse moves pan a little).
    const pan = this.scopePan;
    let tx = 0;
    let tz = 0;
    if (this.scoped) {
      tx = (this.aimPoint.x - px) * SCOPE_PAN_GAIN;
      tz = (this.aimPoint.z - pz) * SCOPE_PAN_GAIN;
      const l = Math.hypot(tx, tz);
      if (l > SCOPE_PAN_MAX) {
        tx *= SCOPE_PAN_MAX / l;
        tz *= SCOPE_PAN_MAX / l;
      }
    }
    const kp = 1 - Math.exp(-dt * (this.scoped ? SCOPE_PAN_RATE : SCOPE_PAN_RATE * 2));
    pan.x += (tx - pan.x) * kp;
    pan.z += (tz - pan.z) * kp;
    this.scopeZoom += ((this.scoped ? 1 : 0) - this.scopeZoom) * kp;
    const dist = CAM_DIST + SCOPE_EXTRA_DIST * this.scopeZoom;
    const h = Math.cos(CAM_PITCH) * dist;
    cam.position.set(f.x + pan.x + Math.sin(CAM_YAW) * h, f.y + Math.sin(CAM_PITCH) * dist, f.z + pan.z + Math.cos(CAM_YAW) * h);
    const shake = this.effects?.shake ?? 0;
    if (shake > 0) cam.position.add(this.focus.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    // Melee from above: a quick dolly towards the player on a hit, a tilt into the swing, a shake.
    if (this.feel.push || this.feel.shake || this.feel.roll) {
      cam.position.lerp(this.focus.set(px, py + 1, pz), Math.min(.12, this.feel.push * .16));
      if (this.feel.shake) cam.position.add(this.focus.set((Math.random() - .5) * this.feel.shake * 2, (Math.random() - .5) * this.feel.shake * 2, (Math.random() - .5) * this.feel.shake * 2));
    }
    cam.rotation.set(-CAM_PITCH, CAM_YAW, this.feel.roll * .5, 'YXZ');
    occlusionUniforms.uFadeCam.value.copy(cam.position);
    occlusionUniforms.uFadeTarget.value.set(px, py + 1.0, pz);
    // Whole props between the camera and the player turn see-through.
    this.props?.updateOcclusion(px, py + 1.1, pz, cam.position.x, cam.position.y, cam.position.z, dt);
  }

  /* ----------------------------------- chunk meshes -------------------------------------- */

  private processBuildQueue(px: number, pz: number, deadline: number): void {
    if (this.buildQueue.size === 0) return;
    // Nearest chunks first.
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const ordered = [...this.buildQueue.entries()].sort(
      ([, a], [, b]) => Math.max(Math.abs(a.cx - pcx), Math.abs(a.cz - pcz)) - Math.max(Math.abs(b.cx - pcx), Math.abs(b.cz - pcz)),
    );
    for (const [key, chunk] of ordered) {
      if (performance.now() >= deadline) break;
      this.buildQueue.delete(key);
      const prev = this.meshes.get(key);
      if (prev) this.disposeChunkMeshes(prev);
      const seaLevel = this.welcome!.world.seaLevel;
      const terrain = new Mesh(buildTerrainGeometry(chunk, seaLevel, this.welcome!.world.cosmeticSeed), this.terrainMaterial);
      terrain.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      terrain.receiveShadow = true;
      terrain.castShadow = chunk.lod === 0;
      terrain.matrixAutoUpdate = false;
      terrain.updateMatrix();
      this.terrainGroup.add(terrain);
      const wg = buildWaterGeometry(chunk);
      let water: Mesh | null = null;
      if (wg && this.waterMaterial) {
        water = new Mesh(wg, this.waterMaterial);
        water.position.copy(terrain.position);
        water.renderOrder = 2;
        water.matrixAutoUpdate = false;
        water.updateMatrix();
        this.terrainGroup.add(water);
      }
      this.meshes.set(key, { chunk, terrain, water });
    }
  }

  private disposeChunkMeshes(m: ChunkMeshes): void {
    this.terrainGroup.remove(m.terrain);
    m.terrain.geometry.dispose();
    if (m.water) {
      this.terrainGroup.remove(m.water);
      m.water.geometry.dispose();
    }
  }

  /* ---------------------------------------- HUD ------------------------------------------ */

  private updateHud(now: number, px: number, py: number, pz: number, tod: number, flags: number): void {
    const elapsed = now - this.lastHud;
    this.fps = Math.round((this.frames * 1000) / Math.max(1, elapsed));
    this.frames = 0;
    // Server ticks we actually receive per second (snapshot rate).
    const tps = Math.round((this.snapshotCount * 1000) / Math.max(1, elapsed));
    this.snapshotCount = 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.lastHud = now;
    const local = this.local!;
    const store = this.store!;
    const sample = store.sample(px, pz);
    let lod0 = 0;
    for (const c of store.chunks.values()) if (c.lod === 0) lod0++;
    const expectedLod0 = (LOD_RINGS[0]! * 2 + 1) ** 2;
    const dead = (flags & EntityFlags.Dead) !== 0;
    let status = this.hud.get().status;
    if (status !== 'disconnected') {
      if (dead) status = 'dead';
      else if (status === 'loading' && local.ready && lod0 >= Math.min(expectedLod0, 25)) {
        // Join only once the whole view is in: every terrain ring, every model and the ground cover.
        const ring = LOD_RINGS[LOD_RINGS.length - 1]!, size = this.welcome!.world.sizeChunks;
        const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
        let expected = 0, have = 0;
        for (let cz = pcz - ring; cz <= pcz + ring; cz++) for (let cx = pcx - ring; cx <= pcx + ring; cx++) {
          if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
          expected++; if (store.get(cx, cz)) have++;
        }
        this.loadingSince ||= now;
        const complete = have >= expected * .98 && !!this.props?.settled && !!this.vegetation?.settled;
        if (complete || now - this.loadingSince > 90_000) { status = 'playing'; this.loadingSince = 0; if (!this.sentReady) { this.sentReady = true; this.conn.sendReady(); } }
        else this.hud.set({ statusDetail: { key: 'raw', vars: { text: `Đang tải bản đồ ${Math.round(have / Math.max(1, expected) * 100)}% · mô hình và cây cối…` } }, loadProgress: have / Math.max(1, expected) });
      }
      else if (status === 'dead') status = 'playing';
    }
    this.hud.set({
      vehicle: (() => {
        const v = this.vehicles?.rider(this.welcome!.playerId) ?? this.vehicles?.nearest(px, py, pz);
        return v ? { name: VEHICLES[v.kind].name, driving: v.driver === this.welcome!.playerId, speed: Math.round(Math.abs(v.speed) * 3.6), health: Math.ceil(v.health / VEHICLES[v.kind].health * 100), exploding: v.health <= 0 && !v.exploded } : null;
      })(),
      status,
      ...(this.hud.get().battle && local.state.flight ? { battle: { ...this.hud.get().battle!, drop: { phase: local.state.flight === 1 ? 'boarding' as const : local.state.flight === 2 ? 'falling' as const : 'parachute' as const, altitude: Math.max(0, py - (store.collision.terrainHeight(px, pz) || 0)), parachuteOpen: local.state.flight === 3, deployIn: Math.max(0, BATTLE_FLIGHT.deployDelayMs / 1000 - (local.state.freefall ?? 0)), speed: Math.hypot(local.state.vx, local.state.vy, local.state.vz) * 3.6, heading: ((this.input.yaw * 180 / Math.PI) % 360 + 360) % 360 } } } : {}),
      loadProgress: Math.min(1, lod0 / expectedLod0),
      fps: this.fps,
      pingMs: Math.round(this.clock.rttMs),
      position: [px, py, pz],
      viewYaw: this.input.yaw,
      chunk: [Math.floor(px / CHUNK_SIZE), Math.floor(pz / CHUNK_SIZE)],
      biome: sample?.biome ?? '—',
      surface: sample?.surface ?? '—',
      temperature: sample?.temperature ?? 0,
      humidity: sample?.humidity ?? 0,
      timeOfDay: tod,
      chunksLoaded: store.chunks.size,
      trianglesK: Math.round(this.renderer.info.render.triangles / 1000),
      debug: {
        tps,
        drawCalls: this.renderer.info.render.calls,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        entities: this.remotes.size + this.zombies.size,
        zombies: this.zombies.size,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        snapshotKB: Math.round(this.conn.bytesIn / 1024),
        frame: this.profiler?.take() ?? null,
      },
      playersNearby: [...this.remotes.values()].filter(r => r.entity.kind === EntityKind.Player).length,
      health: local.health,
      downed: (flags & EntityFlags.Downed) !== 0 ? local.health : null,
      rollCd: Math.min(1, local.state.rollCooldown / Math.round(DEFAULT_CHARACTER.rollCooldown / TICK_DT)),
      swimming: (flags & EntityFlags.Swimming) !== 0,
      respawnIn: dead ? Math.max(0, Math.ceil((RESPAWN_DELAY_MS - (now - this.deadSince)) / 1000)) : 0,
    });
  }
}

/** Guns with a big kick (recoil animation strength). */
function heavyKick(weapon: number): boolean {
  return weapon === WeaponId.Shotgun || weapon === WeaponId.Saiga12 || weapon === WeaponId.DoubleBarrel || weapon === WeaponId.AWM || weapon === WeaponId.SVD
    || weapon === WeaponId.RocketLauncher || weapon === WeaponId.GrenadeLauncher || weapon === WeaponId.Revolver || weapon === WeaponId.PKM || weapon === WeaponId.Barrett
    || weapon === WeaponId.Deagle || weapon === WeaponId.Kar98k || weapon === WeaponId.M79 || weapon === WeaponId.Remington700;
}

/** Reload sound (and playback rate) for each gun. */
function reloadSound(weapon: number): [SoundName, number] {
  switch (weapon) {
    case WeaponId.AK47:
    case WeaponId.Barrett:
    case WeaponId.AWM:
    case WeaponId.PKM:
      return ['akReload', 1];
    case WeaponId.M4A1:
    case WeaponId.AUG:
      return ['rifleReload', 1];
    case WeaponId.SVD:
      return ['rifleReload', 0.92];
    case WeaponId.MP5:
      return ['rifleReload', 1.15];
    case WeaponId.Flamethrower:
      return ['akReload', 0.8];
    case WeaponId.Shotgun:
      return ['shotgunPump', 1];
    case WeaponId.Saiga12:
    case WeaponId.GrenadeLauncher:
      return ['shotgunReload', weapon === WeaponId.GrenadeLauncher ? 0.85 : 1];
    case WeaponId.M79:
      return ['doubleBarrelReload', 0.9];
    case WeaponId.DoubleBarrel:
      return ['doubleBarrelReload', 1];
    case WeaponId.RocketLauncher:
      return ['rocketReload', 1];
    case WeaponId.Crossbow:
      return ['glockReload', 1.5];
    // Added guns share the existing recordings of their closest relatives.
    case WeaponId.Deagle:
      return ['pistolReload', 0.95];
    case WeaponId.Uzi:
      return ['rifleReload', 1.15];
    case WeaponId.ScarH:
      return ['akReload', 0.95];
    case WeaponId.Mini14:
      return ['rifleReload', 1];
    case WeaponId.ScarL:
    case WeaponId.M16:
      return ['rifleReload', 1];
    case WeaponId.Beryl:
    case WeaponId.M762:
      return ['akReload', 1];
    case WeaponId.Vector:
      return ['rifleReload', 1.1];
    case WeaponId.P90:
      return ['rifleReload', .95];
    case WeaponId.Kar98k:
    case WeaponId.Remington700:
      return ['rifleReload', 0.92];
    default:
      return ['pistolReload', 1];
  }
}
