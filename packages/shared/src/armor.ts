/**
 * Armour rules shared by client (inventory, model, prediction) and server (damage, movement).
 * Four slots; each piece reduces incoming damage while it has durability, and its weight slows
 * the wearer down a little.
 */
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

export type ArmorRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface ArmorSpec {
  /** Compact wire id (1…255), stable: never reuse or renumber. */
  id: number;
  item: string;
  name: string;
  slot: ArmorSlot;
  rarity: ArmorRarity;
  /** Fraction of incoming damage this piece absorbs while intact. */
  protection: number;
  /** Damage it can absorb before breaking. */
  durability: number;
  /** Kilograms; weight slows movement slightly. */
  weight: number;
  model: string;
}

/** Share of a full set's protection carried by each slot. */
const SLOT_SHARE: Record<ArmorSlot, number> = { head: 0.2, chest: 0.4, legs: 0.25, feet: 0.15 };
/** Full-set protection and per-piece durability by rarity. */
const TIER: Record<ArmorRarity, { protection: number; durability: number }> = {
  common: { protection: 0.16, durability: 60 },
  uncommon: { protection: 0.26, durability: 100 },
  rare: { protection: 0.36, durability: 160 },
  epic: { protection: 0.46, durability: 220 },
  legendary: { protection: 0.56, durability: 300 },
};

function piece(id: number, item: string, name: string, slot: ArmorSlot, rarity: ArmorRarity, weight: number, file: string): ArmorSpec {
  const t = TIER[rarity];
  return {
    id,
    item,
    name,
    slot,
    rarity,
    protection: Math.round(t.protection * SLOT_SHARE[slot] * 1000) / 1000,
    durability: Math.round(t.durability * (slot === 'chest' ? 1.2 : slot === 'feet' ? 0.8 : 1)),
    weight,
    model: `/models/armors/${file}.bbmodel`,
  };
}

/** Every armour piece, by scavenged quality: worn civilian → firefighter → military → tactical → riot. */
export const ARMOR_SPECS: readonly ArmorSpec[] = [
  piece(1, 'old_hard_hat', 'Old Hard Hat', 'head', 'common', 0.6, 'old-hard-hat'),
  piece(2, 'worn_work_jacket', 'Worn Work Jacket', 'chest', 'common', 1.6, 'worn-work-jacket'),
  piece(3, 'scrap_plastic_jeans', 'Scrap-Plastic Jeans', 'legs', 'common', 1.4, 'scrap-plastic-jeans'),
  piece(4, 'old_leather_boots', 'Old Leather Boots', 'feet', 'common', 1.0, 'old-leather-boots'),
  piece(5, 'old_thick_leather_tunic', 'Thick Leather Tunic', 'chest', 'uncommon', 3.0, 'old-thick-leather-tunic'),
  piece(6, 'old_work_safety_pants', 'Work Safety Pants', 'legs', 'common', 1.6, 'old-work-safety-pants'),
  piece(7, 'old_safety_boots', 'Steel-Toe Safety Boots', 'feet', 'uncommon', 1.8, 'old-safety-boots'),
  piece(8, 'old_fire_helmet', 'Old Fire Helmet', 'head', 'uncommon', 1.3, 'old-fire-helmet'),
  piece(9, 'old_firefighter_jacket', 'Firefighter Jacket', 'chest', 'uncommon', 3.5, 'old-firefighter-jacket'),
  piece(10, 'old_firefighter_pants', 'Firefighter Pants', 'legs', 'uncommon', 3.0, 'old-firefighter-pants'),
  piece(11, 'combat_helmet', 'Combat Helmet', 'head', 'rare', 1.5, 'combat-helmet'),
  piece(12, 'military_combat_shirt', 'Military Combat Shirt', 'chest', 'rare', 3.2, 'military-combat-shirt'),
  piece(13, 'military_combat_pants', 'Military Combat Pants', 'legs', 'rare', 2.4, 'military-combat-pants'),
  piece(14, 'combat_boots', 'Combat Boots', 'feet', 'rare', 1.6, 'combat-boots'),
  piece(15, 'tactical_ballistic_helmet', 'Tactical Ballistic Helmet', 'head', 'epic', 1.4, 'tactical-ballistic-helmet'),
  piece(16, 'tactical_combat_shirt', 'Tactical Combat Shirt', 'chest', 'epic', 3.0, 'tactical-combat-shirt'),
  piece(17, 'tactical_combat_pants', 'Tactical Combat Pants', 'legs', 'epic', 2.2, 'tactical-combat-pants'),
  piece(18, 'tactical_boots', 'Tactical Boots', 'feet', 'epic', 1.4, 'tactical-boots'),
  piece(19, 'riot_control_helmet', 'Riot Control Helmet', 'head', 'legendary', 2.4, 'riot-control-helmet'),
  piece(20, 'riot_protection_jacket', 'Riot Protection Jacket', 'chest', 'legendary', 6.5, 'riot-protection-jacket'),
  piece(21, 'riot_tactical_pants', 'Riot Tactical Pants', 'legs', 'legendary', 4.5, 'riot-tactical-pants'),
  piece(22, 'riot_combat_boots', 'Riot Combat Boots', 'feet', 'legendary', 2.6, 'riot-combat-boots'),
];

export const ARMOR_BY_ITEM: ReadonlyMap<string, ArmorSpec> = new Map(ARMOR_SPECS.map((a) => [a.item, a]));
export const ARMOR_BY_ID: ReadonlyMap<number, ArmorSpec> = new Map(ARMOR_SPECS.map((a) => [a.id, a]));

/** Worn armour as wire ids per slot (0 = none / broken). */
export type ArmorLoadout = Record<ArmorSlot, number>;
export const NO_ARMOR: ArmorLoadout = { head: 0, chest: 0, legs: 0, feet: 0 };

/** 4 slots packed into one u32 (head | chest << 8 | legs << 16 | feet << 24). */
export function packArmor(a: ArmorLoadout): number {
  return ((a.head & 255) | ((a.chest & 255) << 8) | ((a.legs & 255) << 16) | ((a.feet & 255) << 24)) >>> 0;
}

export function unpackArmor(v: number): ArmorLoadout {
  return { head: v & 255, chest: (v >>> 8) & 255, legs: (v >>> 16) & 255, feet: (v >>> 24) & 255 };
}

/** Total damage reduction of a loadout (capped so armour never makes anyone invulnerable). */
export function armorProtection(a: ArmorLoadout): number {
  let p = 0;
  for (const slot of ARMOR_SLOTS) p += ARMOR_BY_ID.get(a[slot])?.protection ?? 0;
  return Math.min(0.6, p);
}

/** Movement speed multiplier from the carried armour weight: −0.4 % per kg, at most −10 %. */
export function armorSpeedFactor(a: ArmorLoadout): number {
  let kg = 0;
  for (const slot of ARMOR_SLOTS) kg += ARMOR_BY_ID.get(a[slot])?.weight ?? 0;
  return 1 - Math.min(0.1, kg * 0.004);
}

export const RARITY_COLOR: Record<ArmorRarity, string> = {
  common: '#9aa0a6',
  uncommon: '#4caf50',
  rare: '#3d8bfd',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

/** Shop price by rarity (per piece; chest pieces cost a little more). */
export function armorPrice(a: ArmorSpec): number {
  const base = { common: 60, uncommon: 140, rare: 300, epic: 520, legendary: 850 }[a.rarity];
  return Math.round(base * (a.slot === 'chest' ? 1.3 : a.slot === 'head' ? 1 : 0.85));
}
