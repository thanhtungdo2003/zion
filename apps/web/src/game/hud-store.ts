import type { BattleState, GameMode, InfectionState, WaveStateMessage, WarfareStateMessage, RankTitle } from '@zion/shared';
import type { BaseLifeMessage, QuestStateMessage, TeamView, TutorialProgress } from '@zion/shared';
import type { Msg } from '@/lib/i18n';

/** Observable HUD state bridging the imperative engine and React (useSyncExternalStore). */
export interface ChatLine {
  rank?: RankTitle;
  announcement?: boolean;
  channel?: 'world' | 'team';
  id: number;
  from: string;
  text: string;
  /** System lines carry a translatable message instead of player text. */
  system?: boolean;
  msg?: Msg;
}

/** Merged base-life state (every part known once the first full message arrived). */
export type LifeState = BaseLifeMessage & Required<Pick<BaseLifeMessage, 'objects' | 'config' | 'plots' | 'animalLoot'>>;

export interface HudState {
  vehicle: { name: string; driving: boolean; speed: number; health: number; exploding: boolean } | null;
  mode: GameMode;
  battle: BattleState | null;
  /** Infection round state (null in the other modes). */
  infection: InfectionState | null;
  /** Wave survival: the match state (waves, team, result). */
  waves: WaveStateMessage | null;
  /** Warfare: tickets, zones, deploy points, squads and the result. */
  warfare: WarfareStateMessage | null;
  pvpEnabled: boolean;
  pvpRemaining: number;
  rank: RankTitle | null;
  promotion: { rank: RankTitle; introduction: string; at: number } | null;
  tutorial: TutorialProgress | null;
  mapOpen: boolean;
  team: TeamView | null;
  tutorialAnchor: { x: number; y: number };
  tutorialTargets: Array<{ id: string; x: number; z: number; angle: number; distance: number }>;
  life: LifeState | null;
  quests: QuestStateMessage['entries'];
  /** Quest NPC whose dialogue is open (E near them), or null. */
  dialogue: { npc: string; name: string } | null;
  /** Empty garden plot the player stands on (shows the seed panel), or null. */
  plot: string | null;
  /** Knocked down: bleed-out left (0…100), or null when standing. */
  downed: number | null;
  /** Battle royale: eliminated, watching this teammate. */
  spectating: string | null;
  /** Solo battle royale: the one watched is our killer, not a teammate. */
  spectatingKiller: boolean;
  /** Reviving someone: progress window (performance.now ms). */
  reviving: { start: number; end: number } | null;
  status: 'connecting' | 'loading' | 'playing' | 'dead' | 'disconnected';
  statusDetail: Msg;
  loadProgress: number;
  pointerLocked: boolean;
  fps: number;
  pingMs: number;
  position: [number, number, number];
  viewYaw: number;
  chunk: [number, number];
  biome: string;
  surface: string;
  temperature: number;
  humidity: number;
  timeOfDay: number;
  chunksLoaded: number;
  trianglesK: number;
  playersNearby: number;
  playersOnline: number;
  /** Tab held: the scoreboard, from the last player list (our own id marks our row). */
  scoreboard: boolean;
  /** Infected sniff skill: active until / ready again at (performance.now() ms). */
  sniffUntil: number;
  sniffReadyAt: number;
  scorePlayers: Array<{ id: number; name: string; rank?: string; kills: number; deaths: number; dead: boolean; zombie: boolean; bot: boolean }>;
  selfId: number;
  health: number;
  swimming: boolean;
  username: string;
  chat: ChatLine[];
  toast: Msg | null;
  /** Last time the local player took damage (ms) and how hard (0…1): drives the red vignette. */
  hurtAt: number;
  /** Field of view lost to worn visors and masks (0…0.4): darkens the screen edges. */
  visorVision: number;
  /** Last time one of our hits landed on an enemy (hit marker), and whether it was a head shot. */
  hitMarkAt: number;
  hitMarkHead: boolean;
  /** Last confirmed kill (banner + streak within a short window). */
  killAt: number;
  killName: string;
  killStreak: number;
  /** Direction a hit came from, relative to the view (radians, 0 = ahead), and when. */
  damageDirAt: number;
  damageDir: number;
  hurtAmount: number;
  respawnIn: number;
  /** Magazine of the gun in hand (null when not holding a gun). */
  ammo: { mag: number; max: number; reserve: number; reload: number | null } | null;
  /** What E does here (open an ammo cache, pick up an item…), or null. */
  interact: Msg | null;
  /** How the target in focus is used: right click (TOP / third person) or F (first person). */
  interactInput: 'mouse' | 'key';
  /** TOP view: where the caption sits (next to the target on screen), px. */
  interactAt: [number, number] | null;
  /** Loose items within reach on our floor (a list to pick from when there are two or more). */
  groundNear: Array<{ id: number; itemId: string; count?: number }>;
  /** Looking through the equipped weapon's scope. */
  scoped: boolean;
  aiming: boolean;
  scopeMagnification: number;
  /** Reticle to draw: optic reticle while scoped, or a red dot while aimed through one. */
  reticle: 'dot' | 'holo' | 'duplex' | 'mildot' | 'rocket' | null;
  /** Looking through a night-vision scope, and whether night vision is on. */
  nvScope: boolean;
  /** The optic's lens shows the magnified view in the 3D scene: no screen overlay. */
  lensScope: boolean;
  nightVision: boolean;
  /** ZCoin balance (server wallet). */
  coins: number;
  /** First aid kit being applied: progress 0…1, or null. */
  healing: number | null;
  /** Edge-of-screen guides to off-screen camp NPCs (screen px, arrow angle, distance m). */
  /** Roll cooldown left, 0…1 (0 = ready). */
  rollCd: number;
  /** F3 debug overlay numbers. */
  debug: { tps: number; drawCalls: number; geometries: number; textures: number; entities: number; zombies: number; heapMB: number | null; snapshotKB: number; frame: { update: number; render: number; gpu: number | null } | null } | null;
  /** Melee combo: blows chained in quick succession (shown near the crosshair). */
  meleeCombo: { n: number; at: number } | null;
  /** Supply drops on the way (map icons with heading) and where each comes down. */
  supply: { planes: Array<{ x: number; z: number; yaw: number; ownerName: string }>; targets: Array<{ x: number; z: number }> } | null;
  /** Holding a blueprint up: what it is and whether it may stand where the hologram is. */
  planning: { name: string; ok: boolean; reason: string | null } | null;
  guides: Array<{ role: string; x: number; y: number; angle: number; dist: number; quest?: boolean; icon?: string; name?: string }>;
}

export function initialHud(): HudState {
  return {
    mode: 'survival',
    battle: null,
    infection: null,
    waves: null,
    warfare: null,
    vehicle: null,
    pvpEnabled: false,
    pvpRemaining: 0,
    rank: null,
    promotion: null,
    tutorial: null,
    mapOpen: false,
    team: null,
    tutorialAnchor: { x: 0, y: 0 },
    tutorialTargets: [],
    life: null,
    quests: [],
    dialogue: null,
    debug: null,
    plot: null,
    downed: null,
    spectating: null,
    spectatingKiller: false,
    reviving: null,
    status: 'connecting',
    statusDetail: { key: 'status.requesting' },
    loadProgress: 0,
    pointerLocked: false,
    fps: 0,
    pingMs: 0,
    position: [0, 0, 0],
    viewYaw: 0,
    chunk: [0, 0],
    biome: '—',
    surface: '—',
    temperature: 0,
    humidity: 0,
    timeOfDay: 0.3,
    chunksLoaded: 0,
    trianglesK: 0,
    playersNearby: 0,
    playersOnline: 0,
    scoreboard: false,
    sniffUntil: 0,
    sniffReadyAt: 0,
    scorePlayers: [],
    selfId: 0,
    health: 100,
    swimming: false,
    username: '',
    chat: [],
    toast: null,
    hurtAt: 0,
    visorVision: 0,
    hitMarkAt: 0,
    hitMarkHead: false,
    killAt: 0,
    killName: '',
    killStreak: 0,
    damageDirAt: 0,
    damageDir: 0,
    hurtAmount: 0,
    respawnIn: 0,
    ammo: null,
    interact: null,
    interactInput: 'mouse',
    interactAt: null,
    groundNear: [],
    scoped: false,
    aiming: false,
    scopeMagnification: 1,
    reticle: null,
    nvScope: false,
    lensScope: false,
    nightVision: false,
    coins: 0,
    healing: null,
    guides: [],
    supply: null,
    meleeCombo: null,
    planning: null,
    rollCd: 0,
  };
}

export class HudStore {
  private state: HudState = initialHud();
  private readonly listeners = new Set<() => void>();

  get = (): HudState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  pushChat(line: Omit<ChatLine, 'id'>): void {
    const chat = [...this.state.chat, { ...line, id: Date.now() + Math.random() }].slice(-30);
    this.set({ chat });
  }
}
