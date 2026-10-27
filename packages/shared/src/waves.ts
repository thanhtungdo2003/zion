import { ZombieVariant } from './zombies';
import { ITEMS } from './items';
import { WEAPON_BY_ITEM, weaponSpec } from './weapons';
import type { InventoryData, PlacedItem } from './inventory';
import { SHOP_STOCK, type ShopCategory } from './shop';

/**
 * Zombie Wave Survival: a party of up to four (real players, or one player with up to three
 * bots) holds out against waves of zombies on an Infection map. Zombies keep their normal health
 * per kind; waves grow by numbers, spawn rhythm, aggression and the mix of kinds.
 */
export const WAVE_TEAM_LIMIT = 4;
export const WAVE_MAX_BOTS = 3;
/**
 * Between waves the shop is open: the next wave starts once every standing player is ready, or
 * after this long at most (nobody can hold the team forever).
 */
export const WAVE_SHOP_MS = 120_000;
/** Cash each member starts a match with, earned per zombie by kind, and per member for a cleared wave. */
export const WAVE_START_CASH = 300;
export const WAVE_KILL_CASH: Record<ZombieVariant, number> = {
  [ZombieVariant.Rotting]: 25, [ZombieVariant.Gaunt]: 30, [ZombieVariant.Crimson]: 40, [ZombieVariant.Brute]: 75,
} as Record<ZombieVariant, number>;
export const waveClearCash = (wave: number): number => 100 + 50 * Math.max(1, wave);

/** What the wave shop sells: guns, heavy weapons, melee, explosives, ammo, medicine, armour and attachments. */
export const WAVE_SHOP_CATEGORIES: readonly ShopCategory[] = ['guns', 'heavy', 'melee', 'explosives', 'ammo', 'medical', 'armor', 'attachments'];
export interface WaveShopEntry { item: string; price: number; category: ShopCategory }
/**
 * The wave shop's stock and prices (the merchant's, guns and gear at 60 %: a match is short).
 * Built from the merchant's stock each time, so weapons made in the Studio are sold too.
 */
export function waveShopStock(): WaveShopEntry[] {
  return SHOP_STOCK.filter((e) => WAVE_SHOP_CATEGORIES.includes(e.category) && ITEMS[e.item])
    .map((e) => ({ item: e.item, category: e.category, price: e.category === 'ammo' || e.category === 'medical' ? e.price : Math.max(10, Math.round(e.price * .6 / 5) * 5) }));
}
export function wavePrice(item: string): number | null {
  return waveShopStock().find((e) => e.item === item)?.price ?? null;
}
/** From the last member's arrival to the first wave. */
export const WAVE_COUNTDOWN_MS = 8_000;
/** Zombies alive at once, whatever the wave (server load and fairness). */
export const WAVE_MAX_ALIVE = 36;

/** 'bots': one player and 0–3 bots; 'friends': a party of real players (no bots). */
export type WavePlayMode = 'bots' | 'friends';
/** 'break': between waves, the shop open. */
export type WavePhase = 'lobby' | 'countdown' | 'fighting' | 'break' | 'over';

/** The eight leaderboards each map has. */
export const WAVE_BOARDS = [
  { id: 'solo', playMode: 'bots', size: 1, name: 'Solo' },
  { id: 'duo_bot', playMode: 'bots', size: 2, name: 'Duo Bot' },
  { id: 'trio_bot', playMode: 'bots', size: 3, name: 'Trio Bot' },
  { id: 'squad_bot', playMode: 'bots', size: 4, name: 'Squad Bot' },
  { id: 'solo_player', playMode: 'friends', size: 1, name: 'Solo Player' },
  { id: 'duo_players', playMode: 'friends', size: 2, name: 'Duo Players' },
  { id: 'trio_players', playMode: 'friends', size: 3, name: 'Trio Players' },
  { id: 'full_squad', playMode: 'friends', size: 4, name: 'Full Squad' },
] as const satisfies ReadonlyArray<{ id: string; playMode: WavePlayMode; size: number; name: string }>;
export type WaveBoard = (typeof WAVE_BOARDS)[number]['id'];
export const isWaveBoard = (id: string): id is WaveBoard => WAVE_BOARDS.some((b) => b.id === id);

/**
 * The board a finished match belongs to. Bot mode counts the team (one player plus its bots);
 * friends mode counts real players only. Anything else (bots in a friends party, two players in
 * bot mode, an empty team) is unranked: null.
 */
export function waveBoard(playMode: WavePlayMode, humans: number, bots: number): WaveBoard | null {
  if (humans < 1 || bots < 0 || humans + bots > WAVE_TEAM_LIMIT) return null;
  if (playMode === 'bots') return humans === 1 && bots <= WAVE_MAX_BOTS ? WAVE_BOARDS.find((b) => b.playMode === 'bots' && b.size === 1 + bots)!.id : null;
  return bots === 0 ? WAVE_BOARDS.find((b) => b.playMode === 'friends' && b.size === humans)!.id : null;
}

export interface WavePlan {
  wave: number;
  /** Zombies this wave sends in total. */
  count: number;
  /** One zombie (or a burst) every this many ms, and how many come at once. */
  spawnEveryMs: number;
  burst: number;
  /** Alive at once. */
  maxAlive: number;
  /** Relative chance of each kind (Rotting, Gaunt, Brute, Crimson). Health never changes. */
  mix: Record<ZombieVariant, number>;
  /** From how many sides the spawns come (encirclement), 1–4. */
  sides: number;
}

/**
 * Difficulty of a wave: more zombies, faster spawns, bigger bursts, more sides at once and a
 * nastier mix (gaunt runners from wave 2, brutes from 4, crimson leapers from 6). Team size scales
 * the count (each extra member adds 45 %), never the zombies' health.
 */
export function wavePlan(wave: number, teamSize = 1): WavePlan {
  const n = Math.max(1, Math.floor(wave)), team = 1 + Math.max(0, Math.min(WAVE_TEAM_LIMIT, teamSize) - 1) * .45;
  const count = Math.round((6 + n * 3 + Math.max(0, n - 5) ** 1.35) * team);
  return {
    wave: n,
    count,
    spawnEveryMs: Math.max(450, Math.round(2600 * .88 ** (n - 1))),
    burst: Math.min(5, 1 + Math.floor((n - 1) / 3)),
    maxAlive: Math.min(WAVE_MAX_ALIVE, Math.round((8 + n * 2.2) * team)),
    mix: {
      [ZombieVariant.Rotting]: Math.max(2, 10 - n),
      [ZombieVariant.Gaunt]: n >= 2 ? Math.min(6, n - 1) : 0,
      [ZombieVariant.Brute]: n >= 4 ? Math.min(3, (n - 2) / 2) : 0,
      [ZombieVariant.Crimson]: n >= 6 ? Math.min(4, (n - 4) / 2) : 0,
    } as Record<ZombieVariant, number>,
    sides: Math.min(4, 1 + Math.floor(n / 3)),
  };
}

/** Picks a kind from a plan's mix with a 0–1 roll. */
export function pickWaveVariant(mix: Record<ZombieVariant, number>, roll: number): ZombieVariant {
  const kinds = [ZombieVariant.Rotting, ZombieVariant.Gaunt, ZombieVariant.Brute, ZombieVariant.Crimson] as const;
  const total = kinds.reduce<number>((s, k) => s + mix[k], 0);
  let r = roll * total;
  for (const k of kinds) { r -= mix[k]; if (r < 0) return k; }
  return ZombieVariant.Rotting;
}

/** One team member as the HUD and results show it. */
export interface WaveMember { id: number; name: string; bot: boolean; alive: boolean; kills: number; cash: number; ready: boolean }

/** Live state of a wave match (sent once a second and on every change). */
export interface WaveStateMessage {
  t: 'waves';
  map: { id: string; name: string };
  playMode: WavePlayMode;
  phase: WavePhase;
  /** The wave being fought, or the next one during a break. */
  wave: number;
  /** Waves fully cleared. */
  cleared: number;
  /** Zombies still to come this wave plus those alive. */
  remaining: number;
  alive: number;
  /** Server time the countdown or the shop ends (0 = none), and the time left when this was sent. */
  endsAt: number;
  msLeft: number;
  /** Server time the first wave began (0 = not yet). */
  startedAt: number;
  members: WaveMember[];
  /** Set once the team is down: what was achieved and where it was recorded. */
  result?: { cleared: number; survivedMs: number; board: WaveBoard | null; rank: number | null };
}

/** A finished match as the server records it (one row per match). */
export interface WaveResult {
  matchId: string;
  mapId: string;
  playMode: WavePlayMode;
  board: WaveBoard;
  /** Waves fully cleared (the ranking), then the time it took to clear the last one (ties). */
  cleared: number;
  clearMs: number;
  survivedMs: number;
  members: Array<{ accountId: string | null; name: string; bot: boolean }>;
}

export interface WaveLeaderboardRow { position: number; members: string[]; cleared: number; clearMs: number; survivedMs: number; at: number }
export interface WaveLeaderboard { mapId: string; board: WaveBoard; rows: WaveLeaderboardRow[] }

/** What each survivor starts a wave match with: a pistol, a machete, three boxes of 9 mm, a medkit. */
export function waveInventory(): InventoryData {
  const gl18 = weaponSpec(WEAPON_BY_ITEM.gl18 ?? 0);
  const items: PlacedItem[] = [
    { uid: 1, itemId: 'gl18', container: 'secondary', x: 0, y: 0, rotated: false, ...(gl18?.kind === 'gun' ? { mag: gl18.magazine } : {}) },
    { uid: 2, itemId: 'machete', container: 'heavy', x: 0, y: 0, rotated: false },
    ...[0, 1, 2].map((x, i): PlacedItem => ({ uid: 3 + i, itemId: 'ammo_9mm', container: 'backpack', x, y: 0, rotated: false, count: ITEMS.ammo_9mm?.ammo?.capacity ?? 30 })),
    { uid: 6, itemId: 'medkit', container: 'backpack', x: 0, y: 1, rotated: false, count: 3 },
  ];
  return { items, equipped: 1 };
}
