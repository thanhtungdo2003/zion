/**
 * Item catalog shared by client (inventory UI) and server (authoritative inventory). Footprints are
 * in grid cells (w × h, unrotated).
 */
import { ARMOR_SPECS, RARITY_COLOR, type ArmorSlot } from './armor';

export type ItemCategory = 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'heavy' | 'grenade' | 'ammo' | 'melee' | 'medical' | 'armor_head' | 'armor_chest' | 'armor_legs' | 'armor_feet' | 'food' | 'resource' | 'tool';

/** Upper-body stance the character model uses while the item is in hand. */
export type Stance = 'unarmed' | 'rifle' | 'pistol' | 'melee' | 'grenade';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  w: number;
  h: number;
  stance: Stance;
  /** Tile tint. */
  color: string;
  /** Short spec line shown in the tooltip. */
  info: string;
  /** Ammo boxes: the guns (item ids) they load and how many rounds a full box holds. */
  ammo?: { guns: string[]; capacity: number };
  /** Consumables with several uses (first aid kit): uses in a fresh one. */
  uses?: number;
  /** Armour pieces: slot and wire id (`count` holds the remaining durability). */
  armor?: { slot: ArmorSlot; id: number; durability: number };
}

export const ITEMS: Record<string, ItemDef> = {
  badge_recruit: { id: 'badge_recruit', name: 'Huy hiệu Tân Binh', category: 'resource', w: 1, h: 1, stance: 'unarmed', color: '#b8b2a2', info: 'Kỷ vật quân vụ · có thể bán lấy ZCoin' },
  badge_private: { id: 'badge_private', name: 'Huy hiệu Binh Nhì', category: 'resource', w: 1, h: 1, stance: 'unarmed', color: '#72b48c', info: 'Kỷ vật quân vụ · có thể bán lấy ZCoin' },
  badge_corporal: { id: 'badge_corporal', name: 'Huy hiệu Hạ Sĩ', category: 'resource', w: 1, h: 1, stance: 'unarmed', color: '#69a7dc', info: 'Kỷ vật quân vụ · có thể bán lấy ZCoin' },
  badge_sergeant: { id: 'badge_sergeant', name: 'Huy hiệu Trung Sĩ', category: 'resource', w: 1, h: 1, stance: 'unarmed', color: '#bd8ce5', info: 'Kỷ vật quân vụ · có thể bán lấy ZCoin' },
  badge_elite: { id: 'badge_elite', name: 'Huy hiệu Tinh Nhuệ', category: 'resource', w: 1, h: 1, stance: 'unarmed', color: '#ffb000', info: 'Kỷ vật quân vụ · có thể bán lấy ZCoin' },
  ak47: { id: 'ak47', name: 'AK-47', category: 'rifle', w: 5, h: 2, stance: 'rifle', color: '#8a6a3a', info: 'Assault rifle · 7.62×39' },
  m4a1: { id: 'm4a1', name: 'M4A1', category: 'rifle', w: 5, h: 2, stance: 'rifle', color: '#4a4f52', info: 'Carbine · 5.56 NATO' },
  aug: { id: 'aug', name: 'Steyr AUG', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#55603e', info: 'Bullpup rifle · 5.56 NATO · RMB 2× scope' },
  svd: { id: 'svd', name: 'SVD Dragunov', category: 'rifle', w: 6, h: 2, stance: 'rifle', color: '#6b4a32', info: 'Marksman rifle · 7.62×54R · RMB scope' },
  awm: { id: 'awm', name: 'AWM', category: 'rifle', w: 6, h: 2, stance: 'rifle', color: '#3f4a3a', info: 'Sniper rifle · .300 Win Mag · RMB 8× scope' },
  shotgun: { id: 'shotgun', name: 'Shotgun', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#6b4a32', info: 'Pump action · 12 gauge' },
  saiga12: { id: 'saiga12', name: 'Saiga-12', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#3d4245', info: 'Semi-auto shotgun · 12 gauge' },
  double_barrel: { id: 'double_barrel', name: 'Double Barrel', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#7a5634', info: 'Break-action · 12 gauge · 2 shells' },
  gl18: { id: 'gl18', name: 'GL18', category: 'pistol', w: 2, h: 2, stance: 'pistol', color: '#4a5560', info: 'Pistol · 9×19' },
  revolver: { id: 'revolver', name: 'Revolver', category: 'pistol', w: 2, h: 2, stance: 'pistol', color: '#5c5650', info: 'Six-shooter · .357 Magnum' },
  mp5: { id: 'mp5', name: 'MP5', category: 'smg', w: 3, h: 2, stance: 'rifle', color: '#4f5a48', info: 'Submachine gun · 9×19' },
  grenade_launcher: { id: 'grenade_launcher', name: 'Grenade Launcher', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#5a6040', info: '40 mm · lobbed, explodes on impact' },
  crossbow: { id: 'crossbow', name: 'Crossbow', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#3c3f44', info: 'Silent · one bolt per reload · RMB 4× scope' },
  rocket_launcher: { id: 'rocket_launcher', name: 'Rocket Launcher', category: 'heavy', w: 6, h: 2, stance: 'rifle', color: '#4d5a3c', info: 'Single-shot · reload after every rocket' },
  flamethrower: { id: 'flamethrower', name: 'Flamethrower', category: 'heavy', w: 5, h: 2, stance: 'rifle', color: '#7a4a2a', info: 'Short-range fire cone · sets targets ablaze' },
  katana: { id: 'katana', name: 'Katana', category: 'melee', w: 5, h: 1, stance: 'melee', color: '#4a3f52', info: 'Fast blade · sweeping cut' },
  shovel: { id: 'shovel', name: 'Xẻng', category: 'melee', w: 6, h: 1, stance: 'melee', color: '#6b6653', info: 'Heavy shovel · sweeping strike' },
  quam: { id: 'quam', name: 'Cây Quắm', category: 'melee', w: 7, h: 1, stance: 'melee', color: '#5a4630', info: 'Polearm hook blade · long reach, heavy cut' },
  flashlight: { id: 'flashlight', name: 'Flashlight', category: 'tool', w: 2, h: 1, stance: 'unarmed', color: '#3a3f44', info: 'Off-hand tool · lights up the way ahead at night (turns on by itself)' },
  medkit: { id: 'medkit', name: 'First Aid Kit', category: 'medical', w: 2, h: 1, stance: 'unarmed', color: '#8a2a2a', info: 'Restores full health · 3 uses · 5 s to apply, interrupted by moving or damage', uses: 3 },
  potato: { id: 'potato', name: 'Potato', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#8a6a3a', info: 'Raw potato · plant it, cook it, or right-click to eat raw (little filling)' },
  potato_cooked: { id: 'potato_cooked', name: 'Baked Potato', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#a8743a', info: 'Cooked potato · right-click to eat' },
  raw_mutton: { id: 'raw_mutton', name: 'Raw Mutton', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#9a3a3a', info: 'Raw meat from a sheep · cook it on a campfire (raw: little filling)' },
  raw_porkchop: { id: 'raw_porkchop', name: 'Raw Porkchop', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#a84a4a', info: 'Raw meat from a boar · cook it on a campfire (raw: little filling)' },
  cooked_mutton: { id: 'cooked_mutton', name: 'Cooked Mutton', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#7a4a2a', info: 'Hearty cooked meat · right-click to eat' },
  cooked_porkchop: { id: 'cooked_porkchop', name: 'Cooked Porkchop', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#8a5a2a', info: 'Cooked meat · right-click to eat' },
  nuclear_cell: { id: 'nuclear_cell', name: 'Nuclear Power Cell', category: 'resource', w: 1, h: 2, stance: 'unarmed', color: '#3a6a3a', info: 'Energy cell salvaged from industrial ruins' },
  coal_carton: { id: 'coal_carton', name: 'Coal Carton', category: 'resource', w: 2, h: 2, stance: 'unarmed', color: '#3a3a3a', info: 'An old carton of coal' },
  grenade: { id: 'grenade', name: 'Grenade', category: 'grenade', w: 1, h: 1, stance: 'grenade', color: '#56663f', info: 'Frag grenade' },
  ammo_762: { id: 'ammo_762', name: '7.62×39', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6e5a32', info: 'AK-47 ammo box · 30 rounds', ammo: { guns: ['ak47'], capacity: 30 } },
  ammo_556: { id: 'ammo_556', name: '5.56 NATO', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#5d6440', info: 'M4A1 / AUG ammo box · 30 rounds', ammo: { guns: ['m4a1', 'aug'], capacity: 30 } },
  ammo_762x54: { id: 'ammo_762x54', name: '7.62×54R', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6a4b30', info: 'SVD ammo box · 20 rounds', ammo: { guns: ['svd'], capacity: 20 } },
  ammo_300wm: { id: 'ammo_300wm', name: '.300 WM', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#55603e', info: 'AWM ammo box · 15 rounds', ammo: { guns: ['awm'], capacity: 15 } },
  ammo_9mm: { id: 'ammo_9mm', name: '9×19', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#4d5864', info: 'GL18 / MP5 ammo box · 30 rounds', ammo: { guns: ['gl18', 'mp5'], capacity: 30 } },
  ammo_357: { id: 'ammo_357', name: '.357 Magnum', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6a5f50', info: 'Revolver ammo box · 18 rounds', ammo: { guns: ['revolver'], capacity: 18 } },
  ammo_12g: { id: 'ammo_12g', name: '12 ga', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#7a3a30', info: 'Shotgun shells · 6 rounds', ammo: { guns: ['shotgun', 'saiga12', 'double_barrel'], capacity: 6 } },
  ammo_40mm: { id: 'ammo_40mm', name: '40 mm HE', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#606a3a', info: 'Grenade launcher pack · 6 rounds', ammo: { guns: ['grenade_launcher'], capacity: 6 } },
  rocket: { id: 'rocket', name: 'Rocket', category: 'ammo', w: 2, h: 1, stance: 'unarmed', color: '#5a5a40', info: 'One rocket for the launcher', ammo: { guns: ['rocket_launcher'], capacity: 1 } },
  bolts: { id: 'bolts', name: 'Bolt Quiver', category: 'ammo', w: 1, h: 2, stance: 'unarmed', color: '#4a3c2c', info: 'Crossbow bolts · 10', ammo: { guns: ['crossbow'], capacity: 10 } },
  fuel_tank: { id: 'fuel_tank', name: 'Fuel Tank', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#8a3a24', info: 'Flamethrower fuel · 100 units', ammo: { guns: ['flamethrower'], capacity: 100 } },
};

// Armour pieces (one 2×2 item each), generated from the shared armour table.
for (const a of ARMOR_SPECS) {
  ITEMS[a.item] = {
    id: a.item,
    name: a.name,
    category: `armor_${a.slot}` as ItemCategory,
    w: 2,
    h: 2,
    stance: 'unarmed',
    color: RARITY_COLOR[a.rarity],
    info: `${a.rarity} · −${Math.round(a.protection * 100)}% damage · ${a.weight} kg`,
    armor: { slot: a.slot, id: a.id, durability: a.durability },
  };
}

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  rifle: 'Rifle',
  tool: 'Tool',
  shotgun: 'Shotgun',
  pistol: 'Pistol',
  smg: 'SMG',
  heavy: 'Heavy',
  grenade: 'Grenade',
  ammo: 'Ammo',
  melee: 'Melee',
  medical: 'Medical',
  armor_head: 'Helmet',
  armor_chest: 'Body armour',
  armor_legs: 'Leg armour',
  armor_feet: 'Boots',
  food: 'Food',
  resource: 'Resource',
};

/** Full `count` of an item that tracks one (rounds in a box, uses of a kit), else undefined. */
export function maxCount(def: ItemDef): number | undefined {
  return def.ammo?.capacity ?? def.uses ?? def.armor?.durability;
}

/** Ammo box item id for a gun item id. */
export function ammoItemFor(gunItemId: string): string | null {
  return Object.values(ITEMS).find((d) => d.ammo?.guns.includes(gunItemId))?.id ?? null;
}

/** What the ammo cache stations hand out (unlimited, as long as the inventory has room). */
export const CACHE_STOCK = ['ammo_300wm', 'ammo_762', 'ammo_556', 'ammo_9mm', 'ammo_12g', 'grenade', 'medkit', 'awm', 'ak47', 'shotgun', 'gl18'] as const;
/** The camp's own caches are an ammo dump only: no weapons are issued there. */
/** Free ammo-cache draws per player per world day. */
export const CACHE_DRAWS_PER_DAY = 3;
export const CAMP_CACHE_STOCK = ['ammo_300wm', 'ammo_762', 'ammo_556', 'ammo_9mm', 'ammo_12g', 'grenade', 'medkit'] as const;
