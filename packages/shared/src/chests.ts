import { ARMOR_SPECS } from './armor';
import { ITEMS, maxCount } from './items';
import { magazineOf, type PlacedItem } from './inventory';

export const CHEST_CAPACITY = 24;
export const CHEST_REACH = 3;
export const CHEST_SEARCH_MS = 5000;
/** Permanent prop asset ids; shared without depending on the assets package. */
export const CHEST_ASSETS: ReadonlySet<number> = new Set([2002, 2004, 2011, 2017]);
export function chestKey(asset: number, x: number, y: number, z: number): string {
  return `${asset}:${Math.round(x * 100)}:${Math.round(y * 100)}:${Math.round(z * 100)}`;
}
/** `day` is the world day a field crate was last restocked on; field crates reset each new day. */
export interface ChestData { items: PlacedItem[]; searched: boolean; revision: number; day?: number; capacity?: number }
export interface ChestStateMessage extends ChestData {
  t: 'chest'; id: string; field: boolean; capacity: number;
  searchRemainingMs: number; busy: boolean; closed?: boolean; error?: string;
}
const ammo = ['ammo_9mm', 'ammo_762', 'ammo_556', 'ammo_12g', 'ammo_357', 'bolts'];
const supplies = ['medkit', 'potato_cooked', 'cooked_mutton', 'cooked_porkchop', 'potato', 'grenade'];
const tools = ['flashlight', 'shovel', 'quam', 'coal_carton', 'fuel_tank'];
const guns = ['gl18', 'revolver', 'mp5', 'ak47', 'shotgun', 'double_barrel', 'crossbow', 'katana', 'long_sledgehammer'];
const armor = ARMOR_SPECS.filter((a) => a.rarity === 'common' || a.rarity === 'uncommon').map((a) => a.item);
const elite = ['awm', 'm4a1', 'aug', 'svd', 'saiga12', 'grenade_launcher', 'rocket_launcher', 'flamethrower', 'nuclear_cell', ...ARMOR_SPECS.filter((a) => a.rarity === 'rare' || a.rarity === 'epic' || a.rarity === 'legendary').map((a) => a.item)];

/** Per-slot odds: ammo 52%, supplies 30%, tools 13%, guns 2.9%, armor 1.9%, elite 0.2%. */
export function rollChestItem(random: () => number = Math.random): string {
  const roll = random();
  if (roll >= .995 && roll < .998) {
    const rarity = random();
    return `badge_${rarity < .55 ? 'recruit' : rarity < .8 ? 'private' : rarity < .93 ? 'corporal' : rarity < .985 ? 'sergeant' : 'elite'}`;
  }
  const pool = roll < .52 ? ammo : roll < .82 ? supplies : roll < .95 ? tools : roll < .979 ? guns : roll < .998 ? armor : elite;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
export function generateChestLoot(existing: readonly PlacedItem[], random: () => number = Math.random): PlacedItem[] {
  const items = existing.map((i) => ({ ...i }));
  const slots = Math.min(CHEST_CAPACITY - items.length, 3 + Math.floor(random() * 4));
  let uid = Math.max(0, ...items.map((i) => i.uid));
  for (let i = 0; i < slots; i++) {
    const itemId = rollChestItem(random);
    const item: PlacedItem = { uid: ++uid, itemId, container: 'backpack', x: 0, y: 0, rotated: false };
    const count = maxCount(ITEMS[itemId]!); if (count) item.count = count;
    const mag = magazineOf(itemId); if (mag !== undefined) item.mag = mag;
    items.push(item);
  }
  return items;
}

/** Combat supplies only; every fresh BR crate has a loaded gun and compatible ammunition. */
export function generateBattleLoot(existing: readonly PlacedItem[], random: () => number = Math.random): PlacedItem[] {
  const items = existing.map(i => ({ ...i }));
  let uid = Math.max(0, ...items.map(i => i.uid));
  const pick = (pool: readonly string[]) => pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  const add = (itemId: string) => {
    if (items.length >= CHEST_CAPACITY) return;
    const item: PlacedItem = { uid: ++uid, itemId, container: 'backpack', x: 0, y: 0, rotated: false };
    const count = maxCount(ITEMS[itemId]!); if (count) item.count = count;
    const mag = magazineOf(itemId); if (mag !== undefined) item.mag = mag;
    items.push(item);
  };
  const gun = pick(['gl18', 'mp5', 'ak47', 'm4a1', 'aug', 'shotgun', 'saiga12', 'svd', 'awm', 'pkm', 'barrett', 'revolver']);
  add(gun);
  add(Object.values(ITEMS).find(item => item.ammo?.guns.includes(gun))!.id);
  add(pick(ARMOR_SPECS.map(a => a.item)));
  for (let i = 0, n = 2 + Math.floor(random() * 3); i < n; i++) {
    const roll = random();
    add(roll < .55 ? pick(['ammo_9mm', 'ammo_762', 'ammo_556', 'ammo_12g', 'ammo_762x54', 'ammo_300wm', 'ammo_pkm', 'ammo_50bmg']) : roll < .8 ? 'medkit' : roll < .9 ? 'grenade' : pick(ARMOR_SPECS.map(a => a.item)));
  }
  return items;
}
