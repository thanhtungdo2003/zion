/**
 * ZCoin economy shared by client (shop UI) and server (authoritative wallet). ZCoin are gold
 * coins: for now players start with a purse and pick up coins some zombies drop; jobs come later.
 */
export const STARTING_ZCOIN = 100;
/** Chance that a dead zombie drops ZCoin on the spot (collected by walking over it). */
export const ZOMBIE_COIN_DROP_CHANCE = 0.05;
/** A drop holds a random number of ZCoin in this range (inclusive). */
export const ZOMBIE_COIN_DROP_MIN = 1;
export const ZOMBIE_COIN_DROP_MAX = 5;
/** How long a dropped coin lies on the ground before it is gone (ms). */
export const COIN_DROP_LIFETIME_MS = 5 * 60_000;
/** Walking this close to a coin picks it up automatically (m). */
export const COIN_PICKUP_REACH = 2.2;
/** How close a player must stand to the weapon merchant to trade. */
export const MERCHANT_REACH = 4;
/** Fraction of the buy price paid back when selling. */
export const SELL_RATE = 0.4;
/** Applying a first aid kit takes this long; the server accepts at most one heal per interval. */
export const MEDKIT_USE_MS = 5000;
/** Testing aid: ZCoin added per press of the inventory's + button. */
export const DEV_COIN_GRANT = 1000;

import { ARMOR_SPECS, armorPrice } from './armor';

export type ShopCategory = 'guns' | 'heavy' | 'melee' | 'explosives' | 'ammo' | 'medical' | 'armor' | 'tools';

export interface ShopEntry {
  item: string;
  price: number;
  category: ShopCategory;
  /** Who sells it: the weapon merchant (default) or the field medic. */
  vendor?: 'weapons' | 'medic';
}

/** The field medic's fee for patching a player up to full health. */
export const NURSE_HEAL_PRICE = 40;

/** What the weapon merchant stocks, in display order. */
export const SHOP_STOCK: readonly ShopEntry[] = [
  ...['recruit', 'private', 'corporal', 'sergeant', 'elite'].map((rank, i) => ({ item: `badge_${rank}`, price: [300, 600, 1100, 1800, 3000][i]!, category: 'tools' as const })),
  { item: 'flashlight', price: 150, category: 'tools' },
  { item: 'gl18', price: 120, category: 'guns' },
  { item: 'revolver', price: 220, category: 'guns' },
  { item: 'mp5', price: 380, category: 'guns' },
  { item: 'shotgun', price: 340, category: 'guns' },
  { item: 'double_barrel', price: 300, category: 'guns' },
  { item: 'saiga12', price: 620, category: 'guns' },
  { item: 'ak47', price: 520, category: 'guns' },
  { item: 'm4a1', price: 600, category: 'guns' },
  { item: 'aug', price: 640, category: 'guns' },
  { item: 'svd', price: 900, category: 'guns' },
  { item: 'awm', price: 1200, category: 'guns' },
  { item: 'crossbow', price: 450, category: 'heavy' },
  { item: 'grenade_launcher', price: 1400, category: 'heavy' },
  { item: 'rocket_launcher', price: 1800, category: 'heavy' },
  { item: 'flamethrower', price: 1500, category: 'heavy' },
  { item: 'katana', price: 260, category: 'melee' },
  { item: 'shovel', price: 140, category: 'melee' },
  { item: 'long_sledgehammer', price: 420, category: 'melee' },
  { item: 'quam', price: 320, category: 'melee' },
  { item: 'grenade', price: 60, category: 'explosives' },
  { item: 'medkit', price: 100, category: 'medical', vendor: 'medic' },
  { item: 'ammo_40mm', price: 180, category: 'explosives' },
  { item: 'rocket', price: 150, category: 'explosives' },
  { item: 'ammo_9mm', price: 30, category: 'ammo' },
  { item: 'ammo_357', price: 30, category: 'ammo' },
  { item: 'ammo_12g', price: 25, category: 'ammo' },
  { item: 'ammo_762', price: 45, category: 'ammo' },
  { item: 'ammo_556', price: 45, category: 'ammo' },
  { item: 'ammo_762x54', price: 60, category: 'ammo' },
  { item: 'ammo_300wm', price: 80, category: 'ammo' },
  { item: 'bolts', price: 40, category: 'ammo' },
  { item: 'fuel_tank', price: 120, category: 'ammo' },
  // Armour, every piece, priced by rarity.
  ...ARMOR_SPECS.map((a) => ({ item: a.item, price: armorPrice(a), category: 'armor' as const })),
];

const PRICE = new Map(SHOP_STOCK.map((e) => [e.item, e.price]));

export function vendorOf(item: string): 'weapons' | 'medic' | null {
  const e = SHOP_STOCK.find((s) => s.item === item);
  return e ? (e.vendor ?? 'weapons') : null;
}

export function buyPrice(item: string): number | null {
  return PRICE.get(item) ?? null;
}

/** Sell price; ammo boxes pay pro rata for the rounds left (`fill` 0…1). */
export function sellPrice(item: string, fill = 1): number {
  const p = PRICE.get(item);
  return p ? Math.floor(p * SELL_RATE * Math.max(0, Math.min(1, fill))) : 0;
}
