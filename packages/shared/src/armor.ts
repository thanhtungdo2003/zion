/**
 * Armour rules shared by client (inventory, model, prediction) and server (damage, movement).
 * Pieces, not sets: every item is its own piece with its own balance. Four slots: a helmet, a
 * face piece (masks, survival mode only), ears (a comms headset) and a vest. Each piece absorbs a
 * share of incoming damage while it has durability; its weight slows the wearer; visors and masks
 * narrow the view; masks muffle hearing and headsets sharpen it.
 */
export type ArmorSlot = 'head' | 'face' | 'ears' | 'chest';
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'face', 'ears', 'chest'];

export type ArmorRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Where an armour model comes from and how it faces in its file. */
export interface ArmorModel {
  /** GLB file (a pack holds several pieces). */
  url: string;
  /** The pack node holding this piece (omitted: the whole file). */
  node?: string;
  /** Turn about +Y (radians) that makes the piece face +Z. */
  yaw?: number;
  /** Size relative to the automatic fit (1 = as fitted), and a nudge in metres (x, y, z). */
  scale?: number;
  offset?: [number, number, number];
}

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
  /** Share of the field of view lost behind visors, lenses and masks (0…1). */
  vision: number;
  /** Hearing: 1 normal, below muffled (masks, closed helmets), above sharpened (headsets). */
  hearing: number;
  /** Masks are a survival-mode item only. */
  survivalOnly?: boolean;
  /** One line on how it plays, for tooltips and the handbook. */
  note: string;
  model: ArmorModel;
}

const HEAD = '/models/gear/armor/head-pack.glb';
const VEST = '/models/gear/armor/vest-pack.glb';

/**
 * Every piece. Ids start at 30: the old block-armour sets (1…22) are retired and never reused.
 * Durability is four times the old sets'.
 */
export const ARMOR_SPECS: readonly ArmorSpec[] = [
  // Helmets.
  { id: 30, item: 'helmet_t1', name: 'Mũ giáp cấp 1', slot: 'head', rarity: 'common', protection: .08, durability: 400, weight: 1.1, vision: 0, hearing: 1, note: 'Mũ nhẹ, che đỉnh và hai bên đầu', model: { url: HEAD, node: 'Helmet_1_T1' } },
  { id: 31, item: 'helmet_t2', name: 'Mũ giáp cấp 2', slot: 'head', rarity: 'uncommon', protection: .11, durability: 640, weight: 1.3, vision: 0, hearing: 1, note: 'Vỏ dày hơn, vẫn thoáng tầm nhìn', model: { url: HEAD, node: 'Helmet_1_T2' } },
  { id: 32, item: 'helmet_military', name: 'Mũ chiến đấu quân đội', slot: 'head', rarity: 'rare', protection: .14, durability: 960, weight: 1.5, vision: 0, hearing: .95, note: 'Che kín tai: nghe kém đi một chút', model: { url: '/models/gear/armor/military-helmet.glb', yaw: -Math.PI / 2, offset: [0, .018, 0] } },
  { id: 33, item: 'helmet_tactical_headset', name: 'Mũ chiến thuật có tai nghe', slot: 'head', rarity: 'epic', protection: .16, durability: 1280, weight: 1.6, vision: 0, hearing: 1.2, note: 'Tai nghe gắn liền khuếch đại tiếng bước chân', model: { url: '/models/gear/armor/tactical-helmet-headset.glb', yaw: -Math.PI / 2 } },
  { id: 34, item: 'helmet_k63', name: 'Mũ K6-3 có kính chắn', slot: 'head', rarity: 'epic', protection: .19, durability: 1440, weight: 2.4, vision: .14, hearing: .8, note: 'Kính chắn chống đạn che mặt: tầm nhìn hẹp, nghe kém', model: { url: '/models/gear/armor/combat-helmet-k63.glb', yaw: Math.PI, scale: 1.04, offset: [0, .03, .015] } },
  { id: 35, item: 'helmet_premium', name: 'Mũ chiến thuật kèm kính', slot: 'head', rarity: 'legendary', protection: .2, durability: 1920, weight: 1.9, vision: .08, hearing: 1, note: 'Kính bảo hộ và tấm che hàm, nhẹ hơn K6-3', model: { url: HEAD, node: 'Helmet_1_Prem' } },
  // Face pieces (survival mode only).
  { id: 40, item: 'mask_shemagh', name: 'Khăn rằn', slot: 'face', rarity: 'common', protection: .01, durability: 160, weight: .2, vision: 0, hearing: 1, survivalOnly: true, note: 'Che bụi, gần như không cản gì', model: { url: HEAD, node: 'Shemagh_1' } },
  { id: 41, item: 'mask_balaclava', name: 'Mũ trùm mặt', slot: 'face', rarity: 'common', protection: .01, durability: 160, weight: .15, vision: 0, hearing: .95, survivalOnly: true, note: 'Ấm và kín, hơi lấp tai', model: { url: HEAD, node: 'MonkeyMask' } },
  { id: 42, item: 'mask_j', name: 'Mặt nạ khúc côn cầu', slot: 'face', rarity: 'uncommon', protection: .04, durability: 400, weight: .4, vision: .06, hearing: 1, survivalOnly: true, note: 'Mặt nạ cứng che mặt, lỗ mắt nhỏ', model: { url: HEAD, node: 'Mask_J' } },
  { id: 43, item: 'mask_ghost', name: 'Mặt nạ Ghost', slot: 'face', rarity: 'rare', protection: .05, durability: 560, weight: .5, vision: .08, hearing: 1, survivalOnly: true, note: 'Khăn đầu lâu và kính râm chiến thuật', model: { url: HEAD, node: 'GoustMask' } },
  { id: 44, item: 'mask_ballistic', name: 'Mặt nạ chống đạn', slot: 'face', rarity: 'epic', protection: .08, durability: 960, weight: .9, vision: .12, hearing: .9, survivalOnly: true, note: 'Thép che kín mặt: chặn mảnh đạn, tầm nhìn hẹp', model: { url: HEAD, node: 'Mask_ballistic' } },
  { id: 45, item: 'mask_gas', name: 'Mặt nạ phòng độc', slot: 'face', rarity: 'rare', protection: .03, durability: 480, weight: .8, vision: .18, hearing: .75, survivalOnly: true, note: 'Lọc khói và khí độc; kính nhỏ, tiếng thở át tiếng xung quanh', model: { url: HEAD, node: 'GasMask' } },
  // Ears.
  { id: 50, item: 'headset_comms', name: 'Tai nghe liên lạc', slot: 'ears', rarity: 'rare', protection: 0, durability: 320, weight: .35, vision: 0, hearing: 1.3, note: 'Khuếch đại tiếng bước chân và tiếng động xa', model: { url: HEAD, node: 'Headset' } },
  // Vests.
  { id: 60, item: 'vest_t0', name: 'Áo đeo chiến thuật', slot: 'chest', rarity: 'common', protection: .1, durability: 480, weight: 2.2, vision: 0, hearing: 1, note: 'Khung đeo nhẹ, chỉ che bụng', model: { url: VEST, node: 'Vest_T0' } },
  { id: 61, item: 'vest_t1', name: 'Áo giáp mềm cấp 1', slot: 'chest', rarity: 'common', protection: .14, durability: 640, weight: 3, vision: 0, hearing: 1, note: 'Giáp mềm che ngực và lưng', model: { url: VEST, node: 'Vest_1_T1' } },
  { id: 62, item: 'vest_t2', name: 'Áo giáp mềm cấp 2', slot: 'chest', rarity: 'uncommon', protection: .18, durability: 960, weight: 4.2, vision: 0, hearing: 1, note: 'Lớp sợi dày hơn, kín sườn', model: { url: VEST, node: 'Vest_1_T2' } },
  { id: 63, item: 'vest_plate', name: 'Áo mang tấm giáp', slot: 'chest', rarity: 'rare', protection: .23, durability: 1280, weight: 6, vision: 0, hearing: 1, note: 'Tấm giáp cứng trước sau, nặng', model: { url: VEST, node: 'Vest' } },
  { id: 64, item: 'vest_c75', name: 'Áo giáp C75', slot: 'chest', rarity: 'epic', protection: .27, durability: 1600, weight: 7, vision: 0, hearing: 1, note: 'Tấm giáp và túi đạn phía trước', model: { url: VEST, node: 'Vest_001' } },
  { id: 65, item: 'vest_premium', name: 'Giáp toàn thân hạng nặng', slot: 'chest', rarity: 'legendary', protection: .33, durability: 2400, weight: 10.5, vision: 0, hearing: 1, note: 'Che cả vai: bảo vệ tốt nhất, chậm nhất', model: { url: VEST, node: 'Vest_1_Prem' } },
];

export const ARMOR_BY_ITEM: ReadonlyMap<string, ArmorSpec> = new Map(ARMOR_SPECS.map((a) => [a.item, a]));
export const ARMOR_BY_ID: ReadonlyMap<number, ArmorSpec> = new Map(ARMOR_SPECS.map((a) => [a.id, a]));

/** Worn armour as wire ids per slot (0 = none / broken). */
export type ArmorLoadout = Record<ArmorSlot, number>;
export const NO_ARMOR: ArmorLoadout = { head: 0, face: 0, ears: 0, chest: 0 };

/** 4 slots packed into one u32 (head | chest << 8 | face << 16 | ears << 24). */
export function packArmor(a: ArmorLoadout): number {
  return ((a.head & 255) | ((a.chest & 255) << 8) | ((a.face & 255) << 16) | ((a.ears & 255) << 24)) >>> 0;
}

export function unpackArmor(v: number): ArmorLoadout {
  return { head: v & 255, chest: (v >>> 8) & 255, face: (v >>> 16) & 255, ears: (v >>> 24) & 255 };
}

/** Total damage reduction of a loadout (capped so armour never makes anyone invulnerable). */
export function armorProtection(a: ArmorLoadout): number {
  let p = 0;
  for (const slot of ARMOR_SLOTS) p += ARMOR_BY_ID.get(a[slot])?.protection ?? 0;
  return Math.min(0.6, p);
}

/** Field of view lost to everything worn (0…0.4). */
export function armorVision(a: ArmorLoadout): number {
  let v = 0;
  for (const slot of ARMOR_SLOTS) v += ARMOR_BY_ID.get(a[slot])?.vision ?? 0;
  return Math.min(.4, v);
}

/** How well the wearer hears (multiplies the world's sound): masks muffle, headsets sharpen. */
export function armorHearing(a: ArmorLoadout): number {
  let h = 1;
  for (const slot of ARMOR_SLOTS) h *= ARMOR_BY_ID.get(a[slot])?.hearing ?? 1;
  return Math.max(.5, Math.min(1.5, h));
}

/** Movement speed multiplier from the carried armour weight: −0.4 % per kg, at most −10 %. */
export function armorSpeedFactor(a: ArmorLoadout): number {
  return 1 - Math.min(0.1, armorWeight(a) * 0.004);
}

export function armorWeight(a: ArmorLoadout): number {
  let kg = 0;
  for (const slot of ARMOR_SLOTS) kg += ARMOR_BY_ID.get(a[slot])?.weight ?? 0;
  return kg;
}

export function armorStaminaFactor(a: ArmorLoadout): number { return 1 + armorWeight(a) * .015; }

export const RARITY_COLOR: Record<ArmorRarity, string> = {
  common: '#9aa0a6',
  uncommon: '#4caf50',
  rare: '#3d8bfd',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

/** Shop price by rarity (per piece; vests cost more, face and ear pieces less). */
export function armorPrice(a: ArmorSpec): number {
  const base = { common: 60, uncommon: 140, rare: 300, epic: 520, legendary: 850 }[a.rarity];
  return Math.round(base * (a.slot === 'chest' ? 1.3 : a.slot === 'head' ? 1 : 0.7));
}
