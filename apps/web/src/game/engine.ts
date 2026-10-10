import { zombieScale, CHEST_ASSETS, CHEST_REACH, chestKey } from '@zion/shared';
import { settingsStore } from '@/lib/settings';
import { applyFirstPersonRoll } from './render/first-person-roll';
import { ViewModel } from './render/viewmodel';
import { groundMaterial } from './render/natural-material';
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
  type WelcomeMessage,
  type HitEvent,
  EntityKind,
  GUARD_MODEL_URL,
  MERCHANT_MODEL_URL,
  MERCHANT_NAME,
  NURSE_MODEL_URL,
  NURSE_NAME,
  NURSE_HEAL_PRICE,
  MERCHANT_REACH,
  ARMOR_BY_ID,
  ARMOR_SLOTS,
  armorSpeedFactor,
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
  MUZZLE_HEIGHT,
  throwScatter,
  WEAPON_BY_ITEM,
  WEAPON_SPECS,
  WeaponId,
  propTransform,
} from '@zion/shared';
import { DEFAULT_CHARACTER, Mask, makeRayHit } from '@zion/physics';
import { CAMP_ASSET, createDefaultRegistry, type AssetRegistry } from '@zion/assets';
import type { HudState, HudStore, LifeState } from './hud-store';
import type { Msg } from '@/lib/i18n';
import type { InventoryStore } from './inventory/inventory';
import { InputController, type TouchAction, type TouchButton } from './input';
import { RemoteEntity } from './interpolation';
import { GameConnection } from './net/connection';
import { ServerClock } from './net/clock';
import { LocalPlayer } from './prediction';
import { AssetLibrary, windUniforms } from './render/asset-library';
import { Avatar } from './render/avatars';
import { loadCharacterModel, type CharacterTemplate } from './render/character-model';
import { prepareGuardModel } from './render/guard-model';
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
import { DebrisSystem } from './render/debris';
import { ParticleFX } from './render/particles';
import { Minimap } from './render/minimap';
import { CampLights } from './render/camp-lights';
import { GroundItems } from './render/ground-items';
import { CharacterPreview } from './render/character-preview';
import { requestArmor } from './render/armor-models';
import { SlashEffects } from './render/slash';
import { GuardFlashlights, type FlashlightPose } from './render/guard-flashlights';
import { PropRenderer } from './render/props';
import { SkySystem } from './render/sky';
import { buildTerrainGeometry, buildWaterGeometry } from './render/terrain';
import { VegetationRenderer } from './render/vegetation';
import { planCooking } from '@zion/shared';
import { createOceanGeometry, createWaterMaterial, getWaterUniforms, snapOcean } from './render/water';
import { ChunkStore } from './world/chunk-store';
import { VisionCone } from './vision-cone';

interface ChunkMeshes {
  chunk: ChunkData;
  terrain: Mesh;
  water: Mesh | null;
}

const MESH_BUILD_BUDGET_MS = 6;
const HUD_INTERVAL_MS = 250;
const PING_INTERVAL_MS = 2000;
/** Top-down camera (Minecraft Dungeons style): fixed diagonal yaw, steep pitch. */
const CAM_YAW = Math.PI / 4;
const CAM_PITCH = 52 * (Math.PI / 180);
/** Fixed camera distance: a medium-wide view. */
const CAM_DIST = 17;
/** First-person: lens and scoped lens (degrees). */
const FP_FOV = 75;
const FP_SCOPE_FOV = 22;

/** Sniper scope: how far the view pans towards the cursor, how fast, and the extra zoom-out. */
const SCOPE_PAN_GAIN = 0.55;
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
export class GameEngine {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.5, 2600);
  private readonly registry: AssetRegistry = createDefaultRegistry();
  private readonly library = new AssetLibrary(this.registry);
  private readonly clock = new ServerClock();
  private readonly conn: GameConnection;
  private readonly input: InputController;
  private readonly resize: ResizeObserver;
  private readonly terrainMaterial = groundMaterial();
  private readonly terrainGroup = new Group();
  private readonly meshes = new Map<number, ChunkMeshes>();
  private readonly buildQueue = new Map<number, ChunkData>();
  private readonly remotes = new Map<number, { entity: RemoteEntity; avatar: Avatar; weapon: number; back?: number; attacking?: boolean; armor?: number }>();
  /** Shop trades waiting for the server's wallet answer: request id → what to do on success. */
  private readonly trades = new Map<number, { buy?: string; sellUid?: number; heal?: boolean }>();
  private nextTrade = 1;
  private nearMerchant = false;
  /** Armour worn last time we told the server / dressed the model ('' = never). */
  private armorKey = '';
  private preview: CharacterPreview | null = null;
  private nearNurse = false;
  /** Camp service NPCs (from the server), for the minimap and edge-of-screen guides. */
  private npcs: Array<{ id: number; role: 'merchant' | 'nurse'; x: number; z: number }> = [];
  private lastGuides = 0;
  private readonly guideTmp = new Vector3();
  /** First aid kit being applied: which one and when it started (ms). */
  private healing: { uid: number; start: number } | null = null;
  /** ZCoin dropped by zombies (server-owned; we only show them and ask to pick up). */
  private readonly coinDrops = new Map<number, Object3D>();
  private readonly weaponCtl: WeaponController;
  /** Sniper scope state: world-space camera pan and the dashed laser (local player only). */
  private scoped = false;
  private readonly scopePan = new Vector3();
  private scopeZoom = 0;
  private laser: Line | null = null;
  private emptyToastAt = 0;
  /** Ammo cache within reach: 'camp' caches issue ammo only. */
  private station: 'field' | 'camp' | null = null;
  private groundItems: GroundItems | null = null;
  private slashes: SlashEffects | null = null;
  private interact = '';
  private lastStationScan = 0;
  private readonly shotRay = makeRayHit();
  private effects: CombatEffects | null = null;
  private lastAmmoKey = '';
  private readonly names = new Map<number, string>();
  private readonly focus = new Vector3();
  private readonly camFocus = new Vector3();
  private camFocusInit = false;
  private readonly raycaster = new Raycaster();
  private readonly aimPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly aimPoint = new Vector3();
  private readonly ndc = new Vector2();
  private sounds: SoundBank | null = null;
  private readonly tmpA = new Vector3();
  private readonly listenerPos = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private character: CharacterTemplate | null = null;
  private guardTemplate: CharacterTemplate | null = null;
  private privateQuestRenderer: BaseLifeRenderer | null = null;
  private lifeRenderer: BaseLifeRenderer | null = null;
  private questNpcDefinitions: QuestNpcMessage['npcs'] = [];
  private nearQuestNpc: { npc: string; name: string } | null = null;
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
  private readonly zombies = new Map<number, { entity: RemoteEntity; avatar: ZombieAvatar; limbs: number; voiceAt: number; lastGroan: number; enraged: boolean; dead?: boolean; hurtAt: number; lastHit: LastHit | null; burnUntil?: number }>();
  private debris: DebrisSystem | null = null;
  private weapons: WeaponLibrary | null = null;
  /** Character field of view; monsters should use `vision.canSee(...)`. */
  vision: VisionCone | null = null;

  private welcome: WelcomeMessage | null = null;
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
  /** First-person view (settings); top-down otherwise. */
  private firstPerson = false;
  private viewModel: ViewModel | null = null;
  private readonly pendingLocalShots: Array<() => void> = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly hud: HudStore,
    private readonly inventory: InventoryStore,
  ) {
    this.weaponCtl = new WeaponController({
      available: (w) => this.inventory.ammoFor(ITEM_BY_WEAPON[w] ?? ''),
      // Rounds actually move on the server (it answers with the new inventory).
      take: (w, n) => Math.min(n, this.inventory.ammoFor(ITEM_BY_WEAPON[w] ?? '')),
    });
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // GPU reset / driver hiccup: keep the context restorable, and reload if it never comes back.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.toast({ key: 'raw', vars: { text: 'Mất ngữ cảnh đồ họa, đang khôi phục…' } });
      this.contextTimer = window.setTimeout(() => window.location.reload(), 4000);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => window.clearTimeout(this.contextTimer));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
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
      openInventory: () => this.onInteract(),
      hotbar: (slot) => this.inventory.selectSlot(slot),
      cycleHotbar: (dir) => this.inventory.cycle(dir),
      reload: () => this.weaponCtl.reload(performance.now(), this.equippedWeapon()),
      heal: () => void this.useMedkit(),
      escape: () => {
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
    this.inventory.subscribe(() => {
      const st = this.inventory.get();
      const now = new Map(st.items.map((i) => [i.uid, i.container as string]));
      const slot = (c: string | undefined) => !!c && (c.startsWith('armor_') || c === 'heavy' || c === 'primary' || c === 'secondary' || c === 'grenades');
      if (prev.size) {
        const moved = st.items.some((i) => slot(i.container) && prev.has(i.uid) && !slot(prev.get(i.uid)));
        if (moved || (st.equipped !== prevEquipped && st.equipped !== null && prev.has(st.equipped))) this.sounds?.play('equip', { volume: 0.55 });
      }
      prev = now;
      prevEquipped = st.equipped;
    });
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
      onWelcome: (m) => this.onWelcome(m),
      onSnapshot: (s) => this.onSnapshot(s),
      onChunk: (c) => this.store?.set(c),
      onUnload: (list) => list.forEach(([cx, cz]) => this.store?.remove(cx, cz)),
      onMessage: (m) => this.onMessage(m),
      onClose: (info) => {
        if (this.disposed) return;
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
    });
  }

  /* ------------------------------------- lifecycle --------------------------------------- */

  async start(): Promise<void> {
    // The character must be fully downloaded and built before the world is entered, so nothing
    // heavy is parsed or uploaded while playing.
    this.hud.set({ status: 'loading', statusDetail: { key: 'status.loading_character' }, loadProgress: 0 });
    try {
      this.character = await loadCharacterModel(undefined, (p) => this.hud.set({ loadProgress: p * 0.6 }));
      this.guardTemplate = prepareGuardModel(await loadCharacterModel(GUARD_MODEL_URL), this.character);
      for (const url of ['/models/mobs/suffolk-sheep.bbmodel', '/models/mobs/tamed-wild-boar.bbmodel']) {
        const template = await loadCharacterModel(url);
        const attack = template.clips.get('snout_nudge');
        if (attack) template.clips.set('melee_attack', attack);
        this.animalTemplates.push(template);
        this.animalByModel.set(url, template);
      }
      for (const url of NPC_MODELS) {
        const t = await loadCharacterModel(url);
        // Give armless-hand rigs (soldiers) hands so they can hold their weapon.
        let ready = t;
        try { if (!t.root.getObjectByName('hand_right')) ready = prepareGuardModel(t, this.character); } catch { ready = t; }
        this.questTemplates.set(url, ready);
      }
      this.merchantTemplate = prepareGuardModel(await loadCharacterModel(MERCHANT_MODEL_URL), this.character);
      this.nurseTemplate = prepareGuardModel(await loadCharacterModel(NURSE_MODEL_URL), this.character);
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_weapons' } });
      this.weapons = await loadWeapons(this.character, (p) => this.hud.set({ loadProgress: 0.6 + p * 0.25 }));
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_zombies' } });
      this.zombieTemplates = await Promise.all(ZOMBIE_MODEL_URLS.map(url => loadCharacterModel(url)));
      this.zombieTemplate = this.zombieTemplates[0]!;
      if (this.disposed) return;
      this.hud.set({ statusDetail: { key: 'status.loading_sounds' } });
      // Loudness is judged from the character's head, not the high camera.
      this.sounds = new SoundBank(() => {
        const s = this.local?.state;
        return s ? this.listenerPos.set(s.x, s.y + 1.6, s.z) : this.camera.position;
      });
      await this.sounds.load((p) => this.hud.set({ loadProgress: 0.85 + p * 0.15 }));
      if (this.disposed) return;
      // Reloads last exactly as long as their sound.
      this.weaponCtl.setReloadMs(WeaponId.AK47, this.sounds.duration('akReload') * 1000);
      this.weaponCtl.setReloadMs(WeaponId.Shotgun, this.sounds.duration('shotgunReload') * 1000);
      this.weaponCtl.setReloadMs(WeaponId.GL18, this.sounds.duration('glockReload') * 1000);
      this.weaponCtl.setReloadMs(WeaponId.DoubleBarrel, this.sounds.duration('doubleBarrelReload') * 1000);
      this.weaponCtl.setReloadMs(WeaponId.RocketLauncher, this.sounds.duration('rocketReload') * 1000);
      this.weaponCtl.onReload = (weapon, ms) => this.onReload(weapon, ms);
      this.weaponCtl.onEmpty = (weapon) => this.onOutOfAmmo(weapon);
      this.hud.set({ statusDetail: { key: 'status.preparing' }, loadProgress: 1 });
      const preview = new Avatar(this.character, true);
      for (const id of this.weapons.keys()) preview.setWeapon(id, this.weapons);
      if (itemIcons.size === 0) renderItemIcons(this.weapons);
      this.preview = new CharacterPreview(this.character);
      this.inventory.preview = this.preview;
      this.inventory.subscribe(() => this.syncArmor());
      const zombiePreview = new ZombieAvatar(this.zombieTemplate, () => undefined);
      zombiePreview.root.visible = true;
      zombiePreview.addTo(this.scene);
      preview.addTo(this.scene);
      await this.renderer.compileAsync(this.scene, this.camera);
      preview.dispose(this.scene);
      zombiePreview.dispose(this.scene);
    } catch (err) {
      this.hud.set({ status: 'disconnected', statusDetail: { key: 'status.assets_failed', vars: { error: (err as Error).message } } });
      return;
    }
    if (this.disposed) return;
    this.hud.set({ status: 'connecting', statusDetail: { key: 'status.authenticating' }, loadProgress: 0 });
    try {
      await this.conn.connect();
      this.hud.set({ statusDetail: { key: 'status.joining' } });
    } catch (err) {
      this.hud.set({ status: 'disconnected', statusDetail: { key: 'raw', vars: { text: (err as Error).message } } });
      return;
    }
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    for (const b of this.bubbles) b.el.remove();
    this.lifeRenderer?.dispose();
    this.privateQuestRenderer?.dispose();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.conn.close();
    this.input.dispose();
    this.resize.disconnect();
    this.vision?.dispose();
    this.viewModel?.dispose();
    this.debris?.dispose();
    this.effects?.dispose();
    this.sounds?.dispose();
    this.props?.dispose();
    this.campLights?.dispose();
    this.guardFlashlights?.dispose();
    this.groundItems?.dispose();
    this.slashes?.dispose();
    this.vegetation?.dispose();
    this.sky?.dispose();
    for (const m of this.meshes.values()) this.disposeChunkMeshes(m);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
    this.minimap = canvas && this.welcome ? new Minimap(canvas, this.welcome.world.seaLevel, this.registry) : null;
  }

  setTutorialBlocked(blocked: boolean): void {
    this.tutorialBlocked = blocked;
    this.input.suspended = blocked || this.chatOpen || this.inventory.get().open;
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open;
    this.input.suspended = open || this.tutorialBlocked || this.inventory.get().open;
  }

  setInventoryOpen(open: boolean): void {
    this.input.suspended = open || this.tutorialBlocked || this.chatOpen;
  }

  lifeAction(op: 'plant' | 'harvest' | 'cook' | 'buy' | 'sell' | 'eat' | 'loot', target: string, choice?: string, uid?: number): void {
    if (op === 'buy' || op === 'sell') markPending(`trade:${target}:${op}`);
    if (op === 'plant') markPending('plant');
    this.conn.sendLife(op, target, choice, uid);
  }

  quest(op: 'accept' | 'cancel' | 'turnin' | 'retrieve', npc: string, quest: string, index?: number): void {
    markPending(`quest:${quest}`);
    this.conn.sendQuest(op, npc, quest, index);
  }

  sendChat(text: string): void {
    const t = text.trim();
    if (t) this.conn.sendChat(t);
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
      step(this.localStepKey, s.x, s.y, s.z, Math.hypot(s.vx, s.vz), flags, l.dead);
    }
    const seen = new Set<number>();
    for (const [id, r] of this.remotes) {
      if (r.entity.kind !== EntityKind.Player) continue;
      seen.add(id);
      const p = r.avatar.root.position;
      const last = this.stepKeys.get(id) ?? { x: p.x, z: p.z, speed: 0 };
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
  private updateFlashlights(): void {
    type Carrier = { x: number; y: number; z: number; yaw: number; dark: number; pitch?: number };
    const l = this.local;
    // Slot 0 is always ours (the shadow-casting light), 1–3 the nearest other carriers.
    let mine: Carrier | null = null;
    if (l && !l.dead && this.inventory.get().items.some((i) => i.container === 'offhand' && i.itemId === 'flashlight')) {
      mine = { x: l.state.x, y: l.state.y, z: l.state.z, yaw: this.input.yaw, dark: this.darkness(l.state.x, l.state.y, l.state.z), pitch: this.firstPerson ? this.input.pitch : undefined };
    }
    const others: Carrier[] = [...this.remotes.values()]
      .filter((r) => r.entity.kind === EntityKind.Player && (r.entity.pose.flags & EntityFlags.Flashlight) && !(r.entity.pose.flags & EntityFlags.Dead))
      .map((r) => ({ x: r.avatar.root.position.x, y: r.avatar.root.position.y, z: r.avatar.root.position.z, yaw: r.entity.pose.yaw, dark: 0 }))
      .sort((a, b) => (a.x - (l?.state.x ?? 0)) ** 2 + (a.z - (l?.state.z ?? 0)) ** 2 - ((b.x - (l?.state.x ?? 0)) ** 2 + (b.z - (l?.state.z ?? 0)) ** 2))
      .slice(0, 3);
    for (const o of others) o.dark = this.darkness(o.x, o.y, o.z);
    const slots = [mine, ...others];
    this.torches.forEach((t, i) => {
      const c = slots[i];
      // On only where it is actually dark (night, under a roof, away from lamps).
      if (!c || c.dark < 0.45) { t.intensity = 0; return; }
      if (c.pitch !== undefined) { this.aimTorch(t, c); return; }
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      const oy = c.y + 1.3;
      // The beam ends at the first wall straight ahead (others' lights have no shadow map).
      const hit = this.store?.collision.raycast(c.x, oy, c.z, fx, 0, fz, 26, Mask.LineOfSight, this.torchHit);
      const wall = hit ? this.torchHit.t : 26;
      // Shine from just past the muzzle so the held gun doesn't shadow its own beam (but never
      // from beyond a wall the player is facing).
      const lead = Math.max(0.2, Math.min(1.25, wall - 0.25));
      t.position.set(c.x + fx * lead, oy, c.z + fz * lead);
      t.target.position.set(c.x + fx * 12, c.y + 0.2, c.z + fz * 12);
      t.distance = hit ? Math.max(2, wall + 1.2) : 26;
      t.intensity = 60 * Math.min(1, (c.dark - 0.45) / 0.3 + 0.35);
    });
  }

  /** First person: the beam follows the view (yaw and pitch) from the eye, like a head/gun light. */
  private aimTorch(t: SpotLight, c: { yaw: number; pitch?: number; dark: number }): void {
    const cam = this.camera.position;
    const p = c.pitch ?? 0;
    const fx = -Math.sin(c.yaw) * Math.cos(p);
    const fy = Math.sin(p);
    const fz = -Math.cos(c.yaw) * Math.cos(p);
    const hit = this.store?.collision.raycast(cam.x, cam.y, cam.z, fx, fy, fz, 26, Mask.LineOfSight, this.torchHit);
    const wall = hit ? this.torchHit.t : 26;
    // Slightly below and right of the eye (the gun), never past a wall right in front.
    const lead = Math.max(0.1, Math.min(0.5, wall - 0.2));
    t.position.set(cam.x + fx * lead + Math.cos(c.yaw) * 0.15, cam.y - 0.15 + fy * lead, cam.z + fz * lead - Math.sin(c.yaw) * 0.15);
    t.target.position.set(cam.x + fx * 12, cam.y + fy * 12, cam.z + fz * 12);
    t.distance = hit ? Math.max(2, wall + 1.2) : 26;
    t.intensity = 60 * Math.min(1, (c.dark - 0.45) / 0.3 + 0.35);
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
      if (this.fireLight && this.fireLight.intensity > 0 && this.fireLight.position.distanceTo(this.tmpC.set(x, y, z)) < 6) light += 0.5 * night;
    }
    return Math.max(0, Math.min(1, 1 - light));
  }

  private readonly lastHits = new Map<number, { kx: number; kz: number; force: number }>();
  /** Help calls from downed players nearby. */
  private readonly distress = new Map<number, { name: string; x: number; z: number; until: number }>();

  /** A downed player within reviving reach, if any. */
  private downedNear(): { id: number } | null {
    const s = this.local?.state;
    if (!s) return null;
    for (const [id, r] of this.remotes) {
      if (r.entity.kind !== EntityKind.Player || !(r.entity.pose.flags & EntityFlags.Downed)) continue;
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

  private fireLight: PointLight | null = null;
  private lastDropFix = 0;

  /** Burning campfires (cooking stations): flames + a flickering warm light on the nearest one. */
  private updateCampfires(px: number, pz: number, now: number): void {
    const life = this.hud.get().life;
    if (!life || !this.effects) return;
    let nearest: { x: number; y: number; z: number } | null = null;
    let nd = 45 * 45;
    for (const st of life.config.stations) {
      const o = life.objects.find((ob) => ob.id === st.id);
      if (!o) continue;
      const d = (o.x - px) ** 2 + (o.z - pz) ** 2;
      if (d > 45 * 45) continue;
      ParticleFX.campfire(this.effects.particles, o.x, o.y, o.z);
      if (d < nd) { nd = d; nearest = o; }
    }
    if (!this.fireLight) {
      this.fireLight = new PointLight(0xff9a40, 0, 12, 2);
      this.scene.add(this.fireLight);
    }
    if (nearest) {
      this.fireLight.position.set(nearest.x, nearest.y + 0.8, nearest.z);
      this.fireLight.intensity = 9 + Math.sin(now * 0.023) * 1.6 + Math.sin(now * 0.061) * 1.2 + Math.random() * 0.8;
    } else this.fireLight.intensity = 0;
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
  resetTouch(): void { this.input.resetTouch(); }
  touchLook(dx: number, dy: number): { x: number; y: number } {
    this.input.touchLook(dx, dy, this.scoped ? 0.4 : 1);
    return { ...this.input.pointer };
  }

  touchAction(action: TouchAction): void {
    if (!this.input.touchEnabled || !this.input.locked || this.input.suspended || this.local?.dead || this.hud.get().downed !== null) return;
    if (action === 'pause') this.input.release();
    else if (action === 'reload') this.weaponCtl.reload(performance.now(), this.equippedWeapon());
    else if (action === 'interact') { this.input.resetTouch(); this.onInteract(); }
    else if (action === 'inventory') { this.input.resetTouch(); this.inventory.setOpen(true); }
    else if (action === 'heal') void this.useMedkit();
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
    const world = m.world;
    const worldSize = world.sizeChunks * world.chunkSize;
    this.clock.seed(m.serverTime);
    this.store = new ChunkStore(worldSize, world.seaLevel, this.registry);
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
    this.slashes?.dispose();
    this.slashes = new SlashEffects(this.scene);
    this.props = new PropRenderer(this.scene, this.library, () => this.store!.chunks.values());
    this.vegetation = new VegetationRenderer(this.scene, (cx, cz) => this.store?.get(cx, cz), world.seaLevel, world.cosmeticSeed, world.camp);
    if (this.minimapCanvas) this.minimap = new Minimap(this.minimapCanvas, world.seaLevel, this.registry);
    this.localAvatar = new Avatar(this.character!, true);
    this.localAvatar.ground = (x, z) => this.groundY(x, z);
    this.localAvatar.addTo(this.scene);
    // (Re)send and re-apply the worn armour for this session.
    this.armorKey = '';
    this.syncArmor();
    this.vision ??= new VisionCone(this.scene);
    this.debris ??= new DebrisSystem(this.scene);
    if (!this.effects) {
      this.effects = new CombatEffects(this.scene, this.weapons?.get('grenade')?.display ?? null, this.sounds, () => this.camera.position);
      const rounds = new Map<string, Object3D>();
      for (const kind of ['grenade40', 'rocket', 'bolt']) {
        const model = this.weapons?.get(`proj_${kind}`)?.display;
        if (model) rounds.set(kind, model);
      }
      this.effects.setProjectileModels(rounds);
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
      },
    });
    this.hud.set({ status: 'loading', statusDetail: { key: 'status.streaming' }, username: m.username });
  }

  private snapshotCount = 0;

  private onSnapshot(s: Snapshot): void {
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
          zb = { entity: new RemoteEntity(e.id, e.kind), avatar: new ZombieAvatar(this.zombieTemplates[zombieVariant(e.weapon)]!, (x, y, z, n) => this.gore(x, y, z, 0, 0, n), zombieScale(zombieVariant(e.weapon))), limbs: e.weapon & 15, voiceAt: performance.now() + Math.random() * 4000, lastGroan: 0, enraged: false, hurtAt: 0, lastHit: null };
          zb.avatar.ground = (x, z) => this.groundY(x, z);
          zb.avatar.addTo(this.scene);
          this.zombies.set(e.id, zb);
        }
        zb.entity.push(s.serverTime, e);
        zb.limbs = e.weapon & 15;
        continue;
      }
      let r = this.remotes.get(e.id);
      if (!r) {
        const template = e.kind === EntityKind.Animal ? (this.animalTemplate(e.id) ?? this.character!) : e.kind === EntityKind.QuestNpc ? (this.questTemplates.get(this.questNpcDefinitions.find((n) => n.id === e.id)?.model ?? '') ?? this.character!) : e.kind === EntityKind.Guard ? this.guardTemplate! : e.kind === EntityKind.Merchant ? this.merchantTemplate! : e.kind === EntityKind.Nurse ? this.nurseTemplate! : this.character!;
        r = { entity: new RemoteEntity(e.id, e.kind), avatar: new Avatar(template, false), weapon: 0 };
        r.avatar.ground = (x, z) => this.groundY(x, z);
        // Four-legged: the whole body faces where it goes (no separate head turn).
        if (e.kind === EntityKind.Animal) r.avatar.rigid = true;
        r.avatar.addTo(this.scene);
        r.avatar.setName(this.remoteName(e.id, e.kind));
        this.remotes.set(e.id, r);
      }
      r.entity.push(s.serverTime, e);
      r.weapon = e.weapon;
      r.back = e.back ?? 0;
      if ((e.armor ?? 0) !== r.armor) {
        r.armor = e.armor ?? 0;
        this.dressAvatar(r.avatar, unpackArmor(r.armor));
      }
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      r.avatar.dispose(this.scene);
      this.remotes.delete(id);
    }
    for (const [id, zb] of this.zombies) {
      if (seen.has(id)) continue;
      zb.avatar.dispose(this.scene);
      this.sounds?.stop(zb);
      this.zombies.delete(id);
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
    if (isZombieId(m.targetId)) {
      const zb = this.zombies.get(m.targetId);
      zb?.avatar.flinchFrom();
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
    zb: { voiceAt: number; lastGroan: number; enraged: boolean; dead?: boolean },
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
    if (dist2 > 45 * 45) return;
    const now = performance.now();
    const at = { x: pose.x, y: pose.y + 1.4, z: pose.z };
    const enraged = pose.health > 0 && pose.health < 30;
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
  setTimeOfDay(tod: number): void {
    this.conn.sendSetTime(tod);
  }

  private onMessage(m: ServerJsonMessage): void {
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
        this.privateQuestRenderer ??= new BaseLifeRenderer(this.scene);
        // Our quest items lying in the world, each at its exact spot (only we see them).
        const objects = m.entries.flatMap((q) => q.status === 'active' && q.retrievalModel ? (q.drops ?? []).map((d, i) => ({ id: `${q.id}#${i}`, model: q.retrievalModel!, x: d.x, y: this.groundY(d.x, d.z), z: d.z })) : []);
        void this.privateQuestRenderer.update(objects).catch((err: unknown) => console.error('Private quest model loading failed', err));
        break;
      }
      case 'pong':
        this.clock.onPong(m.ct, m.st);
        break;
      case 'players':
        this.names.clear();
        for (const p of m.players) this.names.set(p.id, p.name);
        for (const [id, r] of this.remotes) r.avatar.setName(this.remoteName(id, r.entity.kind));
        this.hud.set({ playersOnline: m.players.length });
        break;
      case 'chat':
        this.hud.pushChat({ from: m.from, text: m.text, system: m.system });
        break;
      case 'hit':
        if (m.zone === 'fire') {
          // Flames: no blood, the target catches fire for a moment (refreshed while it burns).
          const zb = this.zombies.get(m.targetId);
          if (zb) zb.burnUntil = performance.now() + 700;
          if (m.targetId === this.welcome?.playerId) this.hud.set({ hurtAt: performance.now(), hurtAmount: 0.4 });
          break;
        }
        this.bloodAt(m);
        if (m.targetId === this.welcome?.playerId) this.hud.set({ hurtAt: performance.now(), hurtAmount: Math.min(1, 0.35 + m.damage / 40) });
        break;
      case 'death':
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
        // Flame / launcher shots carry no pellet ends: aim along the shooter's facing instead.
        const yaw = this.remotes.get(m.shooterId)?.entity.pose.yaw ?? 0;
        const dir = m.ends.length >= 3
          ? this.tmpB.set(m.ends[0]! - m.ox, m.ends[1]! - m.oy, m.ends[2]! - m.oz).normalize()
          : this.tmpB.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        this.effects?.shot(m.shooterId, { weapon: m.w, muzzle, dir, eject: null, right: null, ends: m.ends });
        if (weaponSpec(m.w)?.kind === 'gun' && (weaponSpec(m.w) as { fire?: string }).fire !== 'flame') shooter?.kick(heavyKick(m.w) ? 0.35 : 0.12);
        break;
      }
      case 'grenade':
        this.effects?.throwGrenade(m.id, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, resting: false });
        break;
      case 'explosion':
        this.effects?.explode(m.id, m.x, m.y, m.z, m.radius, m.kind);
        break;
      case 'vegetation':
        this.vegetation?.applyDamage(m);
        break;
      case 'proj': {
        this.effects?.launch(m);
        // Someone else's launcher: their muzzle blast and launch sound (ours played on the trigger).
        if (m.ownerId !== this.welcome?.playerId) {
          const shooter = this.remotes.get(m.ownerId)?.avatar;
          const muzzle = shooter?.weaponPoint('muzzle', this.tmpA) ? this.tmpA : this.tmpA.set(m.x, m.y, m.z);
          const dir = this.tmpB.set(m.vx, m.vy, m.vz).normalize();
          this.effects?.shot(m.ownerId, { weapon: m.w, muzzle, dir, eject: null, right: null, ends: [] });
          shooter?.kick(0.35);
        }
        break;
      }
      case 'projEnd':
        this.effects?.endRound(m.id, m.x, m.y, m.z, m.hit);
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

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    // One bad frame (a stray exception mid-update) must never freeze the view on a white/black
    // screen: log it, skip to rendering, and keep going.
    try {
      this.frameBody(now);
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
    const px = local.prev.x + (local.state.x - local.prev.x) * alpha + local.correction.x;
    const py = local.prev.y + (local.state.y - local.prev.y) * alpha + local.correction.y;
    const pz = local.prev.z + (local.state.z - local.prev.z) * alpha + local.correction.z;

    this.processBuildQueue(px, pz);
    this.vegetation?.update(px, pz);
    if (this.effects) this.vegetation?.emitBurning(this.clock.now(), (x, y, z) => {
      ParticleFX.burning(this.effects!.particles, x, y, z);
    });
    this.props?.update(px, pz, now);

    // Remote players render INTERPOLATION_DELAY in the past between two snapshots.
    const renderTime = this.clock.now() - INTERPOLATION_DELAY_MS;
    for (const r of this.remotes.values()) {
      const pose = r.entity.sample(renderTime);
      const itemId = ITEM_BY_WEAPON[r.weapon] ?? null;
      r.avatar.setWeapon(itemId, this.weapons);
      r.avatar.setBackWeapon(r.back ? (ITEM_BY_WEAPON[r.back] ?? null) : null, this.weapons);
      r.avatar.setStance(itemId ? (ITEMS[itemId]?.stance ?? 'unarmed') : 'unarmed');
      r.avatar.setAimPitch(pose.pitch);
      r.avatar.update(pose.x, pose.y, pose.z, pose.yaw, pose.flags, dt, this.elapsed);
      if (r.entity.kind === EntityKind.Guard) this.guardPoses.push(pose);
      // Remote blade swings: a slash arc when their attack starts.
      const attacking = (pose.flags & EntityFlags.Attacking) !== 0;
      if (attacking && !r.attacking && weaponSpec(r.weapon)?.kind === 'melee') this.slashAt(pose.x, pose.y, pose.z, pose.yaw, r.weapon, r.avatar.slashVariant);
      r.attacking = attacking;
    }
    // Guards switch on flashlights at night, aimed where they look.
    this.guardPoses.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.guardFlashlights?.update(this.guardPoses, this.sky.night);
    this.guardPoses.length = 0;
    // Movement flags come from local prediction so jump/roll animations start on the key press,
    // not a round trip later; the rest (dead, attacking…) stays server-authoritative.
    const predicted = EntityFlags.Grounded | EntityFlags.Swimming | EntityFlags.Rolling | EntityFlags.Climbing | EntityFlags.Sprinting;
    const selfFlags =
      ((local.lastServer?.flags ?? 0) & ~predicted) |
      (local.state.grounded ? EntityFlags.Grounded : 0) |
      (local.state.swimming ? EntityFlags.Swimming : 0) |
      (local.state.rollTicks > 0 ? EntityFlags.Rolling : 0) |
      (local.lastButtons & Buttons.Sprint ? EntityFlags.Sprinting : 0) |
      (local.state.climbing ? EntityFlags.Climbing : 0);
    this.updateAim(px, py, pz);
    this.scanStations(px, pz, now);
    // Zombies: interpolated like players, but only visible inside the vision cone (or very close).
    for (const zb of this.zombies.values()) {
      const pose = zb.entity.sample(renderTime);
      const dx = pose.x - px;
      const dz = pose.z - pz;
      const close = dx * dx + dz * dz < 2.5 * 2.5;
      // Once spotted, a zombie stays visible even after the player looks away.
      zb.avatar.seen = zb.avatar.seen || close || (this.vision?.canSee(pose.x, pose.y + 0.9, pose.z, this.store?.collision) ?? true);
      zb.avatar.update(pose.x, pose.y, pose.z, pose.yaw, pose.flags, zb.limbs, dt);
      if (zb.burnUntil && zb.burnUntil > now && zb.avatar.root.visible && this.effects) ParticleFX.burning(this.effects.particles, pose.x, pose.y, pose.z);
      this.zombieVoice(zb, pose, dx * dx + dz * dz);
    }
    this.updateCampfires(px, pz, now);
    this.updateFootsteps(dt);
    this.updateFlashlights();
    // Quest items: settle them on the ground once their terrain has streamed in.
    if (now - this.lastDropFix > 1000) {
      this.lastDropFix = now;
      const objects = this.hud.get().quests.flatMap((q) => q.status === 'active' && q.retrievalModel ? (q.drops ?? []).map((d, i) => ({ id: `${q.id}#${i}`, model: q.retrievalModel!, x: d.x, y: this.groundY(d.x, d.z), z: d.z })) : []);
      if (objects.length) void this.privateQuestRenderer?.update(objects).catch(() => undefined);
    }
    this.localAvatar?.setStance(this.inventory.stance());
    this.localAvatar?.setWeapon(this.inventory.equippedItemId(), this.weapons);
    this.localAvatar?.setBackWeapon(this.backItemId(), this.weapons);
    this.localAvatar?.setAimPitch(this.input.pitch);
    this.localAvatar?.update(px, py, pz, this.input.yaw, selfFlags, dt, this.elapsed);
    if (this.localAvatar && this.firstPerson) this.localAvatar.root.visible = false;
    if (this.viewModel) {
      const axes = this.input.axes();
      this.viewModel.set(this.inventory.equippedItemId(), this.weapons);
      this.viewModel.update(dt, {
        visible: this.firstPerson && !this.scoped && !local.dead,
        moving: axes.mx !== 0 || axes.mz !== 0,
        sprint: (local.lastButtons & Buttons.Sprint) !== 0,
        reloading: this.weaponCtl.reloading,
        firing: weaponSpec(this.equippedWeapon())?.kind === 'gun' && (this.input.buttons() & Buttons.Attack) !== 0,
        yaw: this.input.yaw,
        pitch: this.input.pitch,
      });
    }

    // Day/night: server time of day, advanced locally between snapshots.
    const daySec = this.welcome!.world.dayLengthSec;
    const tod = (this.timeOfDay + (now - this.todAt) / 1000 / daySec) % 1;
    this.focus.set(px, py, pz);
    this.sky.update(tod, this.elapsed, this.focus, this.clock.now() / 1000);
    this.campLights?.update(store.chunks.values(), px, pz, this.sky.night, now);
    this.updateCamera(px, py, pz, dt);
    if (this.firstPerson && this.viewModel) {
      this.raycaster.setFromCamera(this.ndc.set(0, 0), this.camera);
      const ray = this.raycaster.ray;
      let distance = 100;
      if (store.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance, Mask.LineOfSight, this.shotRay)) distance = this.shotRay.t;
      distance = this.bodyHit(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, distance);
      this.viewModel.aimAt(this.tmpC.copy(ray.direction).multiplyScalar(Math.max(1, distance)).add(ray.origin));
    }
    for (const shot of this.pendingLocalShots.splice(0)) shot();
    this.updateLaser(px, py, pz);
    if (this.hud.get().scoped !== this.scoped) this.hud.set({ scoped: this.scoped });
    this.vision?.update(px, py + DEFAULT_CHARACTER.eyeHeight, pz, this.input.yaw, 0, this.sky.night, this.camera, py, this.store?.collision);
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

    this.renderer.render(this.scene, this.camera);

    if (now - this.lastPing > PING_INTERVAL_MS) {
      this.lastPing = now;
      this.conn.sendPing();
    }
    if (now - this.lastMinimap > 330 && this.minimap) {
      this.lastMinimap = now;
      const others = [...this.remotes.values()].filter((r) => r.entity.kind !== EntityKind.Animal && r.entity.kind !== EntityKind.QuestNpc).map((r) => ({ x: r.entity.pose.x, z: r.entity.pose.z }));
      const seenZombies = [...this.zombies.values()].filter((zb) => zb.avatar.seen && !(zb.entity.pose.flags & EntityFlags.Dead)).map((zb) => ({ x: zb.entity.pose.x, z: zb.entity.pose.z }));
      this.minimap.draw(store.chunks.values(), px, pz, this.input.yaw, others, seenZombies, this.minimapTint(), CAM_YAW, this.mapNpcs(), this.welcome?.world.camp ?? null);
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
      const screenX = this.firstPerson ? Math.cos(yaw) * dx - Math.sin(yaw) * dz : Math.cos(CAM_YAW) * dx - Math.sin(CAM_YAW) * dz;
      const screenY = this.firstPerson ? Math.sin(yaw) * dx + Math.cos(yaw) * dz : Math.sin(CAM_PITCH) * (Math.sin(CAM_YAW) * dx + Math.cos(CAM_YAW) * dz);
      return { ...n, distance: Math.hypot(dx, dz), angle: Math.atan2(-screenX, screenY) };
    }) });
    const guides: HudState['guides'] = [];
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    for (const n of this.mapNpcs()) {
      const dist = Math.hypot(n.x - px, n.z - pz);
      if (dist > GUIDE_RANGE && n.role !== 'target' && n.role !== 'sos') continue;
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
      guides.push({ role: n.role, quest: n.quest, x: w / 2 + dx * k, y: h / 2 - dy * k, angle: Math.atan2(-dy, dx), dist: Math.round(dist) });
    }
    const key = guides.map((g, i) => `${i}${g.role}${g.quest ? '!' : ''}${Math.round(g.x)},${Math.round(g.y)},${g.dist}`).join('|');
    if (key !== this.guidesKey) {
      this.guidesKey = key;
      this.hud.set({ guides });
    }
  }

  private guidesKey = '';

  /** NPC speech bubbles: crisp HTML over the canvas, following the speaker. */
  private bubbles: Array<{ el: HTMLDivElement; npc: number; x: number; y: number; z: number; until: number }> = [];

  private showSpeech(npc: number, text: string, duration: number, x: number, y: number, z: number): void {
    for (const b of this.bubbles.filter((b) => b.npc === npc)) b.until = 0;
    const el = document.createElement('div');
    el.className = 'speech-bubble';
    el.textContent = text;
    this.container.appendChild(el);
    this.bubbles.push({ el, npc, x, y, z, until: performance.now() + duration });
  }

  private updateSpeech(now: number): void {
    if (!this.bubbles.length) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.bubbles = this.bubbles.filter((b) => {
      if (now >= b.until) { b.el.remove(); return false; }
      const pose = this.remotes.get(b.npc)?.entity.pose;
      if (pose) { b.x = pose.x; b.y = pose.y; b.z = pose.z; }
      const v = this.guideTmp.set(b.x, b.y + 2.35, b.z).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
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
    // Screen-relative WASD -> camera-yaw world direction -> the character's yaw-local axes.
    const a = this.input.axes();
    let wx = Math.cos(CAM_YAW) * a.mx - Math.sin(CAM_YAW) * a.mz;
    let wz = -Math.sin(CAM_YAW) * a.mx - Math.cos(CAM_YAW) * a.mz;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }
    const y = this.input.yaw;
    // First person: WASD is already relative to where the character looks.
    const mx = this.firstPerson ? a.mx : Math.max(-1, Math.min(1, wx * Math.cos(y) - wz * Math.sin(y)));
    const mz = this.firstPerson ? a.mz : Math.max(-1, Math.min(1, -wx * Math.sin(y) - wz * Math.cos(y)));
    // The trigger becomes an attack only on ticks where the weapon actually fires.
    const weapon = this.equippedWeapon();
    let buttons = this.input.buttons();
    // Scoped in: planted feet, so no walking, rolling or jumping.
    this.scoped = !!(weaponSpec(weapon) as { scope?: boolean } | undefined)?.scope && this.input.aiming && !local.dead && local.state.grounded && local.state.rollTicks === 0;
    let moveX = mx;
    let moveZ = mz;
    if (this.scoped) {
      moveX = 0;
      moveZ = 0;
      buttons &= ~(Buttons.Jump | Buttons.Roll | Buttons.Sprint);
    }
    // Down on the ground: no moving, no shooting (the server ignores it too).
    if (this.hud.get().downed !== null) {
      moveX = 0;
      moveZ = 0;
      buttons = 0;
    }
    const trigger = (buttons & Buttons.Attack) !== 0;
    buttons &= ~Buttons.Attack;
    // Exhausted (under 10% stamina): no sprinting or rolling (the server enforces the same).
    const life = this.hud.get().life;
    if (life && life.stamina < life.config.stamina.maximum * 0.1) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    let yaw = this.input.yaw;
    let throwDist: number | undefined;
    // Guns can't fire mid-jump (airborne); throwing and melee still can.
    const airborne = !local.state.grounded && !local.state.swimming;
    const isGun = WEAPON_SPECS[weapon as Exclude<WeaponId, 0>]?.kind === 'gun';
    const actionTime = performance.now();
    const action = this.weaponCtl.tick(actionTime, weapon, trigger, !local.dead && local.state.rollTicks === 0 && !(isGun && airborne));
    if (this.weaponCtl.blocksSprint(actionTime, weapon, trigger)) buttons &= ~Buttons.Sprint;
    if (action !== 'none') buttons |= Buttons.Attack;
    const spec = weaponSpec(weapon);
    if (action === 'shot') {
      this.localShot(weapon);
      // Launchers aim at the ground point under the cursor (the lob solves for that distance).
      if (spec?.kind === 'gun' && spec.fire === 'projectile' && this.throwAim.r > 0) {
        const dx = this.throwAim.x - local.state.x;
        const dz = this.throwAim.z - local.state.z;
        throwDist = Math.hypot(dx, dz);
      }
    } else if (action === 'melee' && spec?.kind === 'melee') {
      const variant = this.localAvatar?.slash() ?? 1;
      this.viewModel?.swing(variant);
      this.slashAt(local.state.x, local.state.y, local.state.z, this.input.yaw, weapon, variant);
    } else if (action === 'throw') {
      this.viewModel?.throw();
      // Land somewhere random inside the red circle around the cursor.
      const t = this.throwAim;
      if (t.r > 0) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * t.r;
        const dx = t.x + Math.cos(a) * d - local.state.x;
        const dz = t.z + Math.sin(a) * d - local.state.z;
        throwDist = Math.hypot(dx, dz);
        if (throwDist > 0.1) yaw = Math.atan2(-dx, -dz);
      }
      this.localAvatar?.playOnce('grenade_throw');
    }
    const msg = local.step(moveX, moveZ, yaw, this.input.pitch, buttons, this.clock.now() - INTERPOLATION_DELAY_MS, weapon);
    this.input.acknowledgeTouchPresses();
    if (throwDist !== undefined) msg.td = Math.min(100, throwDist);
    const back = this.backItemId();
    const bw = back ? WEAPON_BY_ITEM[back] : undefined;
    if (bw) msg.bw = bw;
    this.conn.sendInput(msg);
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
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
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
   * Instant local feedback for our own shot: tracers stop at the first wall/prop. The server
   * resolves the real hits (with its own spread) and tells everyone else.
   */
  private localShot(weapon: number): void {
    const spec = WEAPON_SPECS[weapon as Exclude<WeaponId, 0>];
    const local = this.local;
    if (spec?.kind !== 'gun' || !local) return;
    this.viewModel?.kick(spec.pellets > 1 ? 1.3 : 1);
    const s = local.state;
    const yaw = this.input.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const ox = s.x;
    const oy = s.y + MUZZLE_HEIGHT;
    const oz = s.z;
    const ends: number[] = [];
    const pellets = !spec.fire || spec.fire === 'hitscan' ? spec.pellets : 0;
    for (let i = 0; i < pellets; i++) {
      const a = (Math.random() * 2 - 1) * spec.spread;
      const b = (Math.random() * 2 - 1) * spec.spread * 0.5;
      // Aim pitch comes from the cursor distance (see updateAim).
      const p = this.input.pitch + b;
      const dx = -Math.sin(yaw + a) * Math.cos(p);
      const dz = -Math.cos(yaw + a) * Math.cos(p);
      const dy = Math.sin(p);
      const len = Math.hypot(dx, dy, dz);
      let t = spec.range;
      if (this.store?.collision.raycast(ox, oy, oz, dx / len, dy / len, dz / len, spec.range, Mask.LineOfSight, this.shotRay)) t = this.shotRay.t;
      // The round stops in the first body it hits (zombie, animal, player) instead of passing through.
      t = this.bodyHit(ox, oy, oz, dx / len, dy / len, dz / len, t);
      ends.push(ox + (dx / len) * t, oy + (dy / len) * t, oz + (dz / len) * t);
    }
    const heavy = heavyKick(weapon);
    const av = this.localAvatar;
    const dir = new Vector3(fx * Math.cos(this.input.pitch), Math.sin(this.input.pitch), fz * Math.cos(this.input.pitch));
    // Render after this frame's camera and weapon pose, so the flash shares the visible bore.
    this.pendingLocalShots.push(() => {
      const muzzle = this.localWeaponPoint('muzzle', this.tmpA) ? this.tmpA : this.firstPerson
        ? this.tmpA.copy(this.camera.position).addScaledVector(dir, 0.6)
        : this.tmpA.set(ox + fx * 0.6, oy, oz + fz * 0.6);
      const eject = this.localWeaponPoint('eject', this.tmpB) ? this.tmpB : null;
      const id = this.welcome?.playerId ?? 0;
      this.effects?.shot(id, { weapon, muzzle, dir, eject, right: new Vector3(-fz, 0, fx), ends });
    });
    av?.kick(heavy ? 0.35 : 0.12);
  }

  private readonly shotRayObj = new Ray();

  private localWeaponPoint(point: 'muzzle' | 'eject', out: Vector3): boolean {
    if (this.firstPerson && !this.scoped) return this.viewModel?.weaponPoint(point, out) ?? false;
    if (this.firstPerson) return false;
    return this.localAvatar?.weaponPoint(point, out) ?? false;
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
      test(q.x, q.y, q.z, 0.4, 1.85);
    }
    for (const r of this.remotes.values()) {
      if (r.entity.pose.flags & EntityFlags.Dead || !r.avatar.root.visible) continue;
      const q = r.avatar.root.position;
      if (r.entity.kind === EntityKind.Animal) test(q.x, q.y, q.z, 0.6, 1.0);
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
    // Moving (or rolling/jumping) or taking damage interrupts first aid; the kit is not used up.
    const a = this.input.axes();
    const moving = a.mx !== 0 || a.mz !== 0 || (this.input.buttons() & (Buttons.Jump | Buttons.Roll)) !== 0;
    if (this.local?.dead || kitGone || moving || this.hud.get().hurtAt > h.start) {
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
    const ring = new Mesh(new RingGeometry(0.28, 0.36, 28), new MeshBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.coinDrops.set(id, g);
    this.lastStationScan = 0;
  }

  /** Dresses an avatar in a loadout (models load on demand; re-dressed when they arrive). */
  private dressAvatar(avatar: Avatar, loadout: ArmorLoadout): void {
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
  private syncArmor(): void {
    const loadout = this.inventory.wornArmor();
    const key = ARMOR_SLOTS.map((s) => loadout[s]).join(',');
    if (key === this.armorKey) return;
    const first = this.armorKey === '';
    this.armorKey = key;
    if (this.local) this.local.speedMul = armorSpeedFactor(loadout);
    if (this.localAvatar) this.dressAvatar(this.localAvatar, loadout);
    this.preview?.setArmor(loadout);
    if (!first) this.sounds?.playEquip(ARMOR_SLOTS.some((s) => (ARMOR_BY_ID.get(loadout[s])?.weight ?? 0) >= 3));
  }

  private remoteName(id: number, kind: EntityKind): string {
    if (kind === EntityKind.Animal) return '';
    if (kind === EntityKind.QuestNpc) return this.questNpcDefinitions.find((n) => n.id === id)?.name ?? 'NPC';
    if (kind === EntityKind.Guard) return guardName(id);
    if (kind === EntityKind.Merchant) return MERCHANT_NAME;
    if (kind === EntityKind.Nurse) return NURSE_NAME;
    return this.names.get(id) ?? `#${id}`;
  }

  /** Blade swing visual (local or remote), from the weapon's reach. */
  private slashAt(x: number, y: number, z: number, yaw: number, weapon: number, variant: number): void {
    const spec = weaponSpec(weapon);
    if (!this.effects || spec?.kind !== 'melee') return;
    this.slashes?.spawn(x, y + 1.15, z, yaw, Math.min(spec.range, 2.8) * 0.85, variant);
    this.sounds?.play('arrowFly', { at: { x, y: y + 1.2, z }, rate: 1.6, volume: 0.55, maxDistance: 25 });
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
    // NPC trades (no request id): spending coins = a purchase.
    if (m.req === undefined && m.coins < this.hud.get().coins) this.sounds?.play('equip', { volume: 0.7 });
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
    if (trade.buy) {
      // The server put the item in the inventory (its 'inv' message shows it).
      this.sounds?.play('equip', { volume: 0.7 });
    } else if (trade.heal) {
      this.sounds?.play('glockReload', { rate: 0.6, volume: 0.5 });
      const s = this.local?.state;
      if (s && this.effects) for (let i = 0; i < 14; i++) this.effects.particles.glow.emit({ x: s.x + (Math.random() - 0.5) * 0.8, y: s.y + 0.3 + Math.random() * 1.4, z: s.z + (Math.random() - 0.5) * 0.8, vy: 1.2, life: 0.9, size: 0.12, sizeEnd: 0.02, color: [0.45, 1, 0.55], colorEnd: [0.2, 0.8, 0.3], alpha: 0.9 });
    }
  }

  private onOutOfAmmo(weapon: number): void {
    const now = performance.now();
    if (now - this.emptyToastAt < 2000) return;
    this.emptyToastAt = now;
    const box = ammoItemFor(ITEM_BY_WEAPON[weapon] ?? '');
    this.toast(box ? { key: 'toast.out_of_ammo_box', vars: { item: box } } : { key: 'toast.out_of_ammo' });
  }

  private nearChest: string | null = null;

  /** Is the player next to an ammo cache station? Scanned a few times a second. */
  private scanStations(px: number, pz: number, now: number): void {
    if (now - this.lastStationScan < 200 || !this.store) return;
    this.lastStationScan = now;
    const id = CAMP_ASSET['zion-ammo-cache-station'];
    const camp = this.welcome?.world.camp;
    let near: 'field' | 'camp' | null = null;
    let closestChest = CHEST_REACH * CHEST_REACH;
    this.nearChest = null;
    for (const chunk of this.store.chunks.values()) {
      if (chunk.lod !== 0) continue;
      for (const prop of chunk.props) {
        if (prop.asset !== id && !CHEST_ASSETS.has(prop.asset)) continue;
        const t = propTransform(chunk, prop);
        const chestDistance = (t.x - px) ** 2 + (t.z - pz) ** 2;
        const inCampChest = !!camp && Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) <= camp.halfSize + 4;
        if (CHEST_ASSETS.has(prop.asset) && !(prop.asset === id && inCampChest) && chestDistance <= closestChest && Math.abs(t.y - (this.local?.state.y ?? t.y)) <= 2.5) {
          closestChest = chestDistance; this.nearChest = chestKey(prop.asset, t.x, t.y, t.z);
        }
        if (prop.asset !== id) continue;
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
    let talk: { npc: string; name: string } | null = null;
    for (const r of this.remotes.values()) {
      if (r.entity.kind !== EntityKind.QuestNpc) continue;
      const p = r.entity.pose;
      if ((p.x - px) ** 2 + (p.z - pz) ** 2 >= MERCHANT_REACH * MERCHANT_REACH) continue;
      const def = this.questNpcDefinitions.find((n) => n.id === r.entity.id);
      if (def) talk = { npc: def.key, name: def.name };
    }
    this.nearQuestNpc = talk;
    const store = this.storagePos();
    this.nearStorage = !!store && Math.hypot(store.x - px, store.z - pz) <= store.radius;
    const life = this.hud.get().life;
    const onPlot = life && !life.action
      ? life.config.plots.map((pl) => life.objects.find((o) => o.id === pl.id)).find((o) => o && !life.plots[o.id] && Math.abs(o.x - px) <= 0.95 && Math.abs(o.z - pz) <= 0.95)?.id ?? null
      : null;
    if (onPlot !== this.hud.get().plot) this.hud.set({ plot: onPlot });
    const open = this.hud.get().dialogue;
    if (open && open.npc !== talk?.npc) this.hud.set({ dialogue: null });
    const ground = this.groundItems?.nearest(px, pz);
    const lifeHere = this.lifeTarget(px, pz);
    const label: Msg | null = this.hud.get().downed !== null ? null : lifeHere ? lifeHere.label : ground
      ? { key: 'interact.pickup', vars: { item: ground.itemId } }
      : this.downedNear() ? { key: 'interact.revive', vars: { item: this.remoteName(this.downedNear()!.id, EntityKind.Player) } }
      : talk ? { key: 'interact.talk', vars: { item: talk.name } }
      : this.nearChest ? { key: 'interact.chest' }
      : this.nearStorage && !merchant ? { key: 'interact.storage' }
      : merchant ? { key: 'interact.shop' }
      : nurse ? { key: 'interact.nurse' }
      : near === 'camp' ? { key: 'interact.camp_cache' } : near ? { key: 'interact.cache' } : null;
    const sig = label ? `${label.key}:${label.vars?.item ?? ''}` : '';
    if (sig !== this.interact) {
      this.interact = sig;
      this.hud.set({ interact: label });
    }
  }

  /** Farming, cooking, livestock loot and private quest pick-ups within reach (in that order). */
  private lifeTarget(x: number, z: number): { label: Msg; run?: () => void } | null {
    const name = (id: string) => ITEMS[id]?.name ?? id;
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
      if (life.config.stations.some((p) => p.id === o.id)) {
        const batch = planCooking(life.config, this.inventory.get().items);
        if (batch) return { label: { key: 'interact.cook_all', vars: { n: batch.quantity, seconds: Math.ceil(batch.durationMs / 1000) } }, run: () => this.lifeAction('cook', o.id) };
        return { label: { key: 'interact.need_food', vars: { item: '' } } };
      }
    }
    return null;
  }

  /** E: pick up a nearby dropped item, otherwise open the inventory (with the cache if near one). */
  private onInteract(): void {
    // The dead can't rummage through bags or talk.
    if (!this.local || this.local.dead || this.hud.get().downed !== null) return;
    const down = this.downedNear();
    if (down) {
      this.conn.sendRevive(down.id);
      return;
    }
    if (this.hud.get().dialogue) {
      this.closeDialogue();
      return;
    }
    const s = this.local?.state;
    const life = s && !this.local!.dead ? this.lifeTarget(s.x, s.z) : null;
    if (life) { life.run?.(); return; }
    const ground = s && !this.local!.dead ? this.groundItems?.nearest(s.x, s.z) : null;
    if (ground) {
      // The server checks reach and room; its 'inv' / 'groundGone' messages follow.
      this.inventory.pickUpGround(ground.id);
      return;
    }
    if (this.nearQuestNpc) {
      this.hud.set({ dialogue: this.nearQuestNpc });
      return;
    }
    if (this.nearChest) { this.inventory.openChest(this.nearChest); return; }
    this.inventory.setOpen(true, this.nearMerchant ? 'shop' : this.nearNurse ? 'nurse' : this.nearStorage ? 'stash' : this.station);
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
    if (!this.scoped) {
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
    const dx = -Math.sin(yaw) * Math.cos(p);
    const dy = Math.sin(p);
    const dz = -Math.cos(yaw) * Math.cos(p);
    const o = this.localAvatar?.weaponPoint('muzzle', this.tmpA) ? this.tmpA : this.tmpA.set(px, py + MUZZLE_HEIGHT, pz);
    let t = range;
    if (this.store?.collision.raycast(o.x, o.y, o.z, dx, dy, dz, range, Mask.LineOfSight, this.shotRay)) t = this.shotRay.t;
    const pos = this.laser.geometry.getAttribute('position') as Float32BufferAttribute;
    pos.setXYZ(0, o.x, o.y, o.z);
    pos.setXYZ(1, o.x + dx * t, o.y + dy * t, o.z + dz * t);
    pos.needsUpdate = true;
    this.laser.computeLineDistances();
    this.laser.visible = true;
  }

  private onReload(weapon: number, ms: number): void {
    this.conn.sendReload();
    const local = this.local;
    const at = local ? { x: local.state.x, y: local.state.y + 1.2, z: local.state.z } : undefined;
    const [sound, rate] = reloadSound(weapon);
    this.sounds?.play(sound, { at, rate });
    const visual = this.weapons?.get(ITEM_BY_WEAPON[weapon] ?? '');
    if (visual?.reloadClip) this.localAvatar?.playWeaponAnim(visual.reloadClip, ms / 1000);
  }

  private updateAmmoHud(now: number): void {
    const view = this.weaponCtl.view(now, this.equippedWeapon());
    const key = view ? `${view.mag}/${view.max}/${view.reserve}/${view.reload === null ? '' : Math.round(view.reload * 20)}` : '';
    if (key === this.lastAmmoKey) return;
    this.lastAmmoKey = key;
    this.hud.set({ ammo: view });
  }

  /** Grenade aim: centre and scatter radius (r = 0 when not holding a throwable). */
  private readonly throwAim = { x: 0, z: 0, r: 0 };
  private throwMarker: Group | null = null;

  /** Faint red disc around the cursor while a throwable is in hand: where it may land. */
  private updateThrowMarker(px: number, pz: number): void {
    const spec = weaponSpec(this.equippedWeapon());
    // Hand grenades show where they may land; the lobbing grenade launcher shows its blast radius.
    // (Straight-firing rockets need no marker.)
    const blast = spec?.kind === 'gun' && spec.projectile?.lob ? spec.projectile.blast : undefined;
    const maxRange = spec?.kind === 'throw' ? spec.maxRange : spec?.kind === 'gun' && blast ? (spec.projectile?.lob?.maxRange ?? spec.range) : 0;
    const show = maxRange > 0 && this.input.locked && !this.input.suspended && !this.local?.dead;
    if (!show) {
      this.throwAim.r = 0;
      if (this.throwMarker) this.throwMarker.visible = false;
      return;
    }
    let dx = this.aimPoint.x - px;
    let dz = this.aimPoint.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > maxRange) {
      dx *= maxRange / d;
      dz *= maxRange / d;
    }
    const a = this.throwAim;
    a.x = px + dx;
    a.z = pz + dz;
    // Launcher: a small landing marker, not the blast size.
    a.r = spec?.kind === 'throw' ? throwScatter(spec, Math.min(d, spec.maxRange)) : LAUNCHER_MARKER_RADIUS;
    if (!this.throwMarker) {
      const m = new Group();
      const mat = { color: 0xff2a1a, transparent: true, depthWrite: false };
      const fill = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ ...mat, opacity: 0.18 }));
      const edge = new Mesh(new RingGeometry(0.94, 1, 48), new MeshBasicMaterial({ ...mat, opacity: 0.45 }));
      for (const o of [fill, edge]) {
        o.rotation.x = -Math.PI / 2;
        o.renderOrder = 5;
        m.add(o);
      }
      this.scene.add(m);
      this.throwMarker = m;
    }
    const ground = this.store?.collision.terrainHeight(a.x, a.z) ?? Number.NaN;
    this.throwMarker.visible = true;
    this.throwMarker.position.set(a.x, (Number.isFinite(ground) ? ground : this.aimPoint.y - 1) + 0.06, a.z);
    this.throwMarker.scale.setScalar(a.r);
  }

  /** Turns the free cursor into an aim point on the ground; the character faces it. */
  private updateAim(px: number, py: number, pz: number): void {
    this.updateAimInner(px, py, pz);
    this.updateThrowMarker(px, pz);
  }

  private updateAimInner(px: number, py: number, pz: number): void {
    if (!this.input.locked || this.input.suspended || this.local?.dead) return;
    if (this.firstPerson) {
      // Mouse look sets yaw/pitch directly; no aim assist. The aim point (grenades, launchers) is
      // where the view centre meets the ground plane, or far ahead when looking up.
      this.raycaster.setFromCamera(this.ndc.set(0, 0), this.camera);
      this.aimPlane.constant = -py;
      if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint) || this.aimPoint.distanceToSquared(this.camera.position) > 60 * 60) {
        this.aimPoint.copy(this.raycaster.ray.direction).multiplyScalar(60).add(this.camera.position);
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
        this.input.pitch = Math.atan2(target.y - (py + MUZZLE_HEIGHT), h);
        return;
      }
    }
    this.input.yaw = Math.atan2(-dx, -dz);
    // Scoped: a flat shot at torso height so long range shots don't sail over targets.
    let pitch = this.scoped ? Math.atan2(this.aimPoint.y - (py + MUZZLE_HEIGHT), Math.sqrt(d2)) : aimPitch(Math.sqrt(d2));
    // Scoped bows/launchers: hold over for the round's drop so it comes down on the cursor.
    const spec = weaponSpec(this.equippedWeapon());
    const proj = spec?.kind === 'gun' ? spec.projectile : undefined;
    if (this.scoped && proj && !proj.lob && proj.gravity > 0) pitch += Math.atan((proj.gravity * Math.sqrt(d2)) / (2 * proj.speed * proj.speed));
    this.input.pitch = pitch;
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
      const scale = zb.avatar.root.scale.x;
      this.hitBox.min.set(zp.x - 0.45 * scale, zp.y, zp.z - 0.45 * scale);
      this.hitBox.max.set(zp.x + 0.45 * scale, zp.y + 1.85 * scale, zp.z + 0.45 * scale);
      if (!ray.intersectBox(this.hitBox, this.tmpB)) continue;
      const d = this.tmpB.distanceToSquared(ray.origin);
      if (d >= best) continue;
      best = d;
      found = true;
      // Keep the hovered height (head vs body) but aim at the body's centre line.
      this.hoverPoint.set(zp.x, Math.min(zp.y + 1.7 * scale, Math.max(zp.y + 0.4 * scale, this.tmpB.y)), zp.z);
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

  /** Follows the first-person setting: camera lens, mouse capture, cone overlay, own body. */
  private applyViewMode(): void {
    const settings = settingsStore.get();
    this.input.setTouchEnabled(settings.touchControls);
    this.renderer.toneMappingExposure = settings.brightness;
    const fp = settings.firstPerson;
    this.input.sensitivity = settings.mouseSens * 0.00004;
    const hud = this.hud.get();
    this.input.freeCursor = fp && (!!this.local?.dead || !!hud.dialogue || hud.downed !== null);
    if (fp === this.firstPerson) return;
    this.firstPerson = fp;
    this.input.setFirstPerson(fp);
    this.input.pitch = 0;
    this.vision?.setOverlay(!fp);
    if (fp && !this.viewModel) {
      // The camera must be in the scene for its children (the held weapon) to render.
      if (!this.camera.parent) this.scene.add(this.camera);
      this.viewModel = new ViewModel(this.camera);
    }
    if (this.localAvatar) this.localAvatar.root.visible = true;
    this.camera.fov = fp ? FP_FOV : 40;
    this.camera.near = fp ? 0.05 : 0.5;
    this.camera.updateProjectionMatrix();
    this.camFocusInit = false;
  }

  private updateCamera(px: number, py: number, pz: number, dt: number): void {
    // A non-finite position (bad snapshot) would blank the whole view: hold the last camera.
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    const cam = this.camera;
    if (this.firstPerson) {
      // Smooth the eye: prediction corrections and step-ups would otherwise jolt the whole view.
      const eye = py + DEFAULT_CHARACTER.eyeHeight;
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
      this.scopeZoom += ((this.scoped ? 1 : 0) - this.scopeZoom) * (1 - Math.exp(-dt * SCOPE_PAN_RATE * 2));
      const fov = FP_FOV + (FP_SCOPE_FOV - FP_FOV) * this.scopeZoom;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      // Eye slightly ahead of the head so the near plane never clips the face/hat.
      cam.position.set(f.x - Math.sin(this.input.yaw) * 0.12, f.y, f.z - Math.cos(this.input.yaw) * 0.12);
      // Screen shake is much stronger up close: a quarter of it is plenty in first person.
      const shake = (this.effects?.shake ?? 0) * 0.25;
      if (shake > 0) cam.position.add(this.focus.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      cam.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
      if (this.local && !this.local.dead && this.hud.get().downed === null) {
        applyFirstPersonRoll(cam, this.local.state, this.local.prev.rollTicks, this.accumulator / TICK_DT);
      }
      // Nothing is see-through in first person: park the fade target far below the world and let
      // every faded prop ease back to solid.
      occlusionUniforms.uFadeCam.value.copy(cam.position);
      occlusionUniforms.uFadeTarget.value.set(0, -1e5, 0);
      this.props?.updateOcclusion(1e9, -1e5, 1e9, cam.position.x, cam.position.y, cam.position.z, dt);
      return;
    }
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
    cam.rotation.set(-CAM_PITCH, CAM_YAW, 0, 'YXZ');
    occlusionUniforms.uFadeCam.value.copy(cam.position);
    occlusionUniforms.uFadeTarget.value.set(px, py + 1.0, pz);
    // Whole props between the camera and the player turn see-through.
    this.props?.updateOcclusion(px, py + 1.1, pz, cam.position.x, cam.position.y, cam.position.z, dt);
  }

  /* ----------------------------------- chunk meshes -------------------------------------- */

  private processBuildQueue(px: number, pz: number): void {
    if (this.buildQueue.size === 0) return;
    const t0 = performance.now();
    // Nearest chunks first.
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const ordered = [...this.buildQueue.entries()].sort(
      ([, a], [, b]) => Math.max(Math.abs(a.cx - pcx), Math.abs(a.cz - pcz)) - Math.max(Math.abs(b.cx - pcx), Math.abs(b.cz - pcz)),
    );
    let touchedNear = false;
    for (const [key, chunk] of ordered) {
      if (performance.now() - t0 > MESH_BUILD_BUDGET_MS) break;
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
      if (Math.abs(chunk.cx - pcx) <= 2 && Math.abs(chunk.cz - pcz) <= 2) touchedNear = true;
    }
    if (touchedNear) this.vegetation?.update(px, pz, true);
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
      else if (status === 'loading' && local.ready && lod0 >= Math.min(expectedLod0, 25)) status = 'playing';
      else if (status === 'dead') status = 'playing';
    }
    this.hud.set({
      status,
      loadProgress: Math.min(1, lod0 / expectedLod0),
      fps: this.fps,
      pingMs: Math.round(this.clock.rttMs),
      position: [px, py, pz],
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
    || weapon === WeaponId.RocketLauncher || weapon === WeaponId.GrenadeLauncher || weapon === WeaponId.Revolver;
}

/** Reload sound (and playback rate) for each gun. */
function reloadSound(weapon: number): [SoundName, number] {
  switch (weapon) {
    case WeaponId.AK47:
    case WeaponId.AWM:
      return ['akReload', 1];
    case WeaponId.M4A1:
    case WeaponId.AUG:
      return ['akReload', 1.08];
    case WeaponId.SVD:
      return ['akReload', 0.95];
    case WeaponId.MP5:
      return ['akReload', 1.2];
    case WeaponId.Flamethrower:
      return ['akReload', 0.8];
    case WeaponId.Shotgun:
    case WeaponId.Saiga12:
    case WeaponId.GrenadeLauncher:
      return ['shotgunReload', weapon === WeaponId.GrenadeLauncher ? 0.85 : 1];
    case WeaponId.DoubleBarrel:
      return ['doubleBarrelReload', 1];
    case WeaponId.RocketLauncher:
      return ['rocketReload', 1];
    case WeaponId.Crossbow:
      return ['glockReload', 1.5];
    default:
      return ['glockReload', 1];
  }
}
