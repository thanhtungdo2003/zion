import { ITEMS } from './items';
import { WEAPON_BY_ITEM, weaponSpec } from './weapons';
import type { InventoryData, PlacedItem } from './inventory';

/**
 * Infection ("Lây Nhiễm"): a small, dense night map; everyone starts human with a chosen loadout
 * and unlimited ammunition, a few are turned at random, and every zombie hit turns a human. The
 * humans win by holding out until the clock runs down, the zombies by turning everyone.
 */
export const INFECTION_MAP = { id: 'friday-13', name: 'Thứ 6 Ngày 13', seed: 'zion-friday-13', sizeChunks: 16, maxPlayers: 16, botFill: 12 } as const;

export const INFECTION = {
  /** Real players needed before the match counts down (bots fill the rest)... */
  minPlayers: 2,
  /** ...or this long after the first player entered the lobby, with whoever came. */
  lobbyWaitMs: 45_000,
  /** Rounds in one match; then everyone goes back to the menu. */
  rounds: 3,
  countdownMs: 20_000,
  /** After the round starts, the first zombies are chosen this much later. */
  outbreakMs: 12_000,
  roundMs: 180_000,
  finishedMs: 9_000,
  /** One patient zero per this many entrants (at least one). */
  perZombie: 8,
  /** Zombie health (a human has 100); bullets keep their full damage. */
  zombieHealth: 200,
  zombieSpeed: 1.3,
  zombieJump: 1.4,
  zombieRespawnMs: 4_000,
  /** Knockback when a zombie is shot: m/s per point of damage, capped. */
  knockPerDamage: .22,
  knockMax: 9,
  /** Night clock for the map (fraction of the day). */
  timeOfDay: 22.5 / 24,
} as const;

/** The weapon a zombie swings (one hit turns a human). */
export const ZOMBIE_WEAPON_ITEM = 'fire_axe';

export interface InfectionLoadout { primary: string; secondary: string; melee: string }
export const DEFAULT_INFECTION_LOADOUT: InfectionLoadout = { primary: 'ak47', secondary: 'uzi', melee: 'katana' };
/** Throwables everyone carries: 2 frag, 2 flash. */
export const INFECTION_THROWABLES = ['grenade', 'grenade', 'flashbang', 'flashbang'] as const;

export type InfectionSlot = keyof InfectionLoadout;

/** Ordinary bullet guns only: no launchers, flamethrowers or bolts with unlimited ammunition. */
function bulletGun(itemId: string): boolean {
  const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
  return spec?.kind === 'gun' && !spec.burn && (!spec.projectile || spec.projectile.kind === 'bullet');
}

/** Items that may go in a loadout slot (Studio weapons included, as they register in ITEMS). */
export function infectionChoices(slot: InfectionSlot): string[] {
  return Object.values(ITEMS).filter((def) => {
    if (slot === 'melee') return def.category === 'melee' && weaponSpec(WEAPON_BY_ITEM[def.id] ?? 0)?.kind === 'melee';
    if (slot === 'primary') return (def.category === 'rifle' || def.category === 'shotgun') && def.w <= 6 && bulletGun(def.id);
    return (def.category === 'pistol' || def.category === 'smg') && def.w <= 4 && bulletGun(def.id);
  }).map((def) => def.id);
}

/** Untrusted loadout → a valid one (anything not allowed falls back to the default). */
export function sanitizeInfectionLoadout(raw: Partial<Record<InfectionSlot, unknown>> | null | undefined): InfectionLoadout {
  const out = { ...DEFAULT_INFECTION_LOADOUT };
  for (const slot of ['primary', 'secondary', 'melee'] as const) {
    const id = raw?.[slot];
    if (typeof id === 'string' && infectionChoices(slot).includes(id)) out[slot] = id;
  }
  return out;
}

/** Inventory for a human in a round: primary, secondary, melee and the four throwables. */
export function infectionInventory(loadout: InfectionLoadout): InventoryData {
  let uid = 1;
  const item = (itemId: string, container: PlacedItem['container'], x: number): PlacedItem => {
    const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
    return { uid: uid++, itemId, container, x, y: 0, rotated: false, ...(spec?.kind === 'gun' ? { mag: spec.magazine } : {}) };
  };
  const items = [item(loadout.primary, 'primary', 0), item(loadout.secondary, 'secondary', 0), item(loadout.melee, 'heavy', 0), ...INFECTION_THROWABLES.map((id, i) => item(id, 'grenades', i))];
  return { items, equipped: 1 };
}

/** A zombie carries only its axe. */
export function zombieInventory(): InventoryData {
  return { items: [{ uid: 1, itemId: ZOMBIE_WEAPON_ITEM, container: 'heavy', x: 0, y: 0, rotated: false }], equipped: 1 };
}

export interface InfectionState {
  t: 'infection';
  phase: 'waiting' | 'countdown' | 'running' | 'finished';
  map: string;
  round: number;
  remainingMs: number;
  humans: number;
  zombies: number;
  /** Every zombie in the match (players and bots). */
  zombieIds: number[];
  /** Set once the round is decided. */
  winner: 'humans' | 'zombies' | null;
  /** Rounds in the match, and real players in it (the lobby waits for `minPlayers`). */
  rounds: number;
  players: number;
  /** The last round is over: the match ends. */
  over?: boolean;
  /** The map's rules the client needs (prediction, light, HUD). */
  rules: { zombieSpeed: number; zombieJump: number; timeOfDay: number; knockMax: number; minPlayers: number };
  /** The receiving player is a zombie. */
  infected?: boolean;
  /** Zombie waiting to rise again: ms left. */
  respawnMs?: number;
}
