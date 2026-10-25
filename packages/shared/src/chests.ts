import { WEAPON_ATTACHMENTS } from './attachments';
import { lootableCustomWeapons } from './custom-weapons';
import { WEAPON_BY_ITEM } from './weapons';
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
const ammo = ['ammo_9mm', 'ammo_762', 'ammo_556', 'ammo_12g', 'ammo_357', 'ammo_762x51', 'ammo_57x28', 'bolts'];
const supplies = ['medkit', 'potato_cooked', 'cooked_mutton', 'cooked_porkchop', 'potato', 'grenade', 'flashbang', 'smoke_grenade'];
const tools = ['flashlight', 'military_backpack', 'shovel', 'quam', 'coal_carton', 'fuel_tank', 'red_dot', 'scope_2x', 'suppressor_pistol', 'compensator'];
const guns = ['gl18', 'revolver', 'deagle', 'uzi', 'vector', 'p90', 'mp5', 'ak47', 'shotgun', 'double_barrel', 'crossbow', 'katana', 'long_sledgehammer', 'machete', 'baseball_bat', 'crowbar'];
/** Building materials: raw wood, stone and ore, and now and then a power cell. */
const resources = ['plank', 'plank', 'stone', 'stone', 'iron_ore', 'copper_ore', 'lead_ore', 'wood_log', 'nuclear_cell'];
/** Battle royale: everything but the survival-only pieces (masks). */
const battleArmor = ARMOR_SPECS.filter((a) => !a.survivalOnly).map((a) => a.item);
const armor = ARMOR_SPECS.filter((a) => a.rarity === 'common' || a.rarity === 'uncommon').map((a) => a.item);
const elite = ['awm', 'm4a1', 'aug', 'svd', 'scar_h', 'scar_l', 'm16', 'beryl', 'm762', 'kar98k', 'mini14', 'scope_4x', 'scope_8x', 'nv_scope_6x', 'suppressor_rifle', 'suppressor_sniper', 'compensator_rifle', 'remington700', 'm79', 'saiga12', 'grenade_launcher', 'rocket_launcher', 'flamethrower', 'nuclear_cell', ...ARMOR_SPECS.filter((a) => a.rarity === 'rare' || a.rarity === 'epic' || a.rarity === 'legendary').map((a) => a.item)];

/** Per-slot odds: ammo 44%, resources 12%, supplies 26%, tools 13%, guns 2.9%, armor 1.9%, elite 0.2%. */
export function rollChestItem(random: () => number = Math.random): string {
  const roll = random();
  if (roll >= .995 && roll < .998) {
    const rarity = random();
    return `badge_${rarity < .55 ? 'recruit' : rarity < .8 ? 'private' : rarity < .93 ? 'corporal' : rarity < .985 ? 'sergeant' : 'elite'}`;
  }
  const pool = roll < .44 ? ammo : roll < .56 ? resources : roll < .82 ? supplies : roll < .95 ? tools : roll < .979 ? guns : roll < .998 ? armor : elite;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
export function generateChestLoot(existing: readonly PlacedItem[], random: () => number = Math.random): PlacedItem[] {
  const items = existing.map((i) => ({ ...i }));
  const slots = Math.min(CHEST_CAPACITY - items.length, 3 + Math.floor(random() * 4));
  let uid = Math.max(0, ...items.map((i) => i.uid));
  for (let i = 0; i < slots; i++) {
    const itemId = rollChestItem(random);
    const item: PlacedItem = { uid: ++uid, itemId, container: 'backpack', x: 0, y: 0, rotated: false };
    const def = ITEMS[itemId]!, count = maxCount(def);
    // A handful of a building material, not a full stack.
    if (def.stack) item.count = Math.min(def.stack, 2 + Math.floor(random() * 5));
    else if (count) item.count = count;
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
  const gun = pick([...lootableCustomWeapons().filter((id) => ITEMS[id] && WEAPON_BY_ITEM[id] && ITEMS[id]!.category !== 'melee'), 'gl18', 'mp5', 'uzi', 'vector', 'p90', 'deagle', 'scar_h', 'scar_l', 'm16', 'beryl', 'm762', 'kar98k', 'mini14', 'ak47', 'm4a1', 'aug', 'shotgun', 'saiga12', 'svd', 'awm', 'pkm', 'barrett', 'revolver']);
  add(gun);
  add(Object.values(ITEMS).find(item => item.ammo?.guns.includes(gun))!.id);
  add(pick(battleArmor));
  // Guns are bare: a compatible attachment turns up in about half of the crates.
  const fits = Object.values(WEAPON_ATTACHMENTS[gun] ?? {}).flat();
  if (fits.length && random() < .5) add(pick(fits));
  // A melee weapon in most crates, for fights up close or when ammunition runs out.
  if (random() < .7) add(pick(['katana', 'quam', 'shovel', 'fire_axe', 'long_sledgehammer', 'machete', 'baseball_bat', 'crowbar']));
  for (let i = 0, n = 2 + Math.floor(random() * 3); i < n; i++) {
    const roll = random();
    add(roll < .55 ? pick(['ammo_9mm', 'ammo_762', 'ammo_556', 'ammo_12g', 'ammo_762x54', 'ammo_762x51', 'ammo_57x28', 'ammo_357', 'ammo_300wm', 'ammo_pkm', 'ammo_50bmg']) : roll < .8 ? 'medkit' : roll < .86 ? 'grenade' : roll < .91 ? 'flashbang' : roll < .95 ? 'smoke_grenade' : pick(battleArmor));
  }
  return items;
}
