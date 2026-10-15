/**
 * Item catalog shared by client (inventory UI) and server (authoritative inventory). Footprints are
 * in grid cells (w × h, unrotated).
 */
import { ARMOR_SPECS, RARITY_COLOR, type ArmorSlot } from './armor';

export type ItemCategory = 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'heavy' | 'grenade' | 'ammo' | 'melee' | 'medical' | 'armor_head' | 'armor_chest' | 'armor_legs' | 'armor_feet' | 'food' | 'resource' | 'tool' | 'attachment';

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
  aug: { id: 'aug', name: 'Steyr AUG', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#55603e', info: 'Bullpup rifle · 5.56 NATO · takes optics' },
  svd: { id: 'svd', name: 'SVD Dragunov', category: 'rifle', w: 6, h: 2, stance: 'rifle', color: '#6b4a32', info: 'Marksman rifle · 7.62×54R · takes 4×–8× optics' },
  awm: { id: 'awm', name: 'AWM', category: 'rifle', w: 6, h: 2, stance: 'rifle', color: '#3f4a3a', info: 'Sniper rifle · .300 Win Mag · takes 4×–10× optics' },
  shotgun: { id: 'shotgun', name: 'Súng săn', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#6b4a32', info: 'Pump action · 12 gauge' },
  saiga12: { id: 'saiga12', name: 'Saiga-12', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#3d4245', info: 'Semi-auto shotgun · 12 gauge' },
  double_barrel: { id: 'double_barrel', name: 'Súng hai nòng', category: 'shotgun', w: 5, h: 2, stance: 'rifle', color: '#7a5634', info: 'Break-action · 12 gauge · 2 shells' },
  gl18: { id: 'gl18', name: 'GL18', category: 'pistol', w: 2, h: 2, stance: 'pistol', color: '#4a5560', info: 'Pistol · 9×19' },
  vector: { id: 'vector', name: 'KRISS Vector', category: 'smg', w: 3, h: 2, stance: 'rifle', color: '#2e3236', info: 'Submachine gun · 9×19 · very fast fire' },
  p90: { id: 'p90', name: 'P90', category: 'smg', w: 3, h: 2, stance: 'rifle', color: '#3a3e36', info: 'Personal defence weapon · 5.7×28 · 50-round magazine' },
  scar_l: { id: 'scar_l', name: 'SCAR-L', category: 'rifle', w: 5, h: 2, stance: 'rifle', color: '#7c6e50', info: 'Assault rifle · 5.56 NATO' },
  deagle: { id: 'deagle', name: 'Desert Eagle', category: 'pistol', w: 2, h: 2, stance: 'pistol', color: '#6d6a64', info: 'Heavy pistol · .357 Magnum' },
  uzi: { id: 'uzi', name: 'UZI', category: 'smg', w: 3, h: 2, stance: 'rifle', color: '#3c4044', info: 'Machine pistol · 9×19' },
  scar_h: { id: 'scar_h', name: 'SCAR-H', category: 'rifle', w: 5, h: 2, stance: 'rifle', color: '#8a7a5a', info: 'Battle rifle · 7.62×51' },
  kar98k: { id: 'kar98k', name: 'Kar98k', category: 'rifle', w: 6, h: 2, stance: 'rifle', color: '#6a4a2c', info: 'Bolt-action rifle · 7.62×54R · iron sights, takes 4×–10× optics' },
  mini14: { id: 'mini14', name: 'Mini-14', category: 'rifle', w: 5, h: 2, stance: 'rifle', color: '#7a5a3a', info: 'Marksman rifle · 5.56 NATO · iron sights, takes optics' },
  revolver: { id: 'revolver', name: 'Súng ổ xoay', category: 'pistol', w: 2, h: 2, stance: 'pistol', color: '#5c5650', info: 'Six-shooter · .357 Magnum' },
  mp5: { id: 'mp5', name: 'MP5', category: 'smg', w: 3, h: 2, stance: 'rifle', color: '#4f5a48', info: 'Submachine gun · 9×19' },
  grenade_launcher: { id: 'grenade_launcher', name: 'Súng phóng lựu', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#5a6040', info: '40 mm · lobbed, explodes on impact' },
  crossbow: { id: 'crossbow', name: 'Nỏ', category: 'rifle', w: 4, h: 2, stance: 'rifle', color: '#3c3f44', info: 'Silent · one bolt per reload · RMB 4× scope' },
  rocket_launcher: { id: 'rocket_launcher', name: 'Súng phóng tên lửa', category: 'heavy', w: 6, h: 2, stance: 'rifle', color: '#4d5a3c', info: 'Single-shot · reload after every rocket' },
  flamethrower: { id: 'flamethrower', name: 'Súng phun lửa', category: 'heavy', w: 5, h: 2, stance: 'rifle', color: '#7a4a2a', info: 'Short-range fire cone · sets targets ablaze' },
  pkm: { id: 'pkm', name: 'Súng máy PKM', category: 'heavy', w: 7, h: 2, stance: 'rifle', color: '#4e5741', info: '7.62×54R · băng 100 viên · súng máy tự động' },
  barrett: { id: 'barrett', name: 'Barrett M82', category: 'heavy', w: 8, h: 2, stance: 'rifle', color: '#53574e', info: '.50 BMG · băng 10 viên · ngắm 10× · đẩy lùi mạnh' },
  fire_axe: { id: 'fire_axe', name: 'Rìu cứu hỏa', category: 'melee', w: 5, h: 2, stance: 'melee', color: '#873c2c', info: 'Rìu sắc · 18% chặt đầu zombie · đòn chém chậm, mạnh' },
  machete: { id: 'machete', name: 'Dao rựa', category: 'melee', w: 4, h: 1, stance: 'melee', color: '#5d5a52', info: 'Short blade · fastest swing · 10% zombie decapitation' },
  baseball_bat: { id: 'baseball_bat', name: 'Gậy bóng chày', category: 'melee', w: 5, h: 1, stance: 'melee', color: '#9a7448', info: 'Blunt · stuns the target briefly' },
  crowbar: { id: 'crowbar', name: 'Xà beng', category: 'melee', w: 4, h: 1, stance: 'melee', color: '#8a2e26', info: 'Heavy steel bar · hard hits, narrow swing' },
  katana: { id: 'katana', name: 'Katana', category: 'melee', w: 5, h: 1, stance: 'melee', color: '#4a3f52', info: 'Fast blade · sweeping cut' },
  shovel: { id: 'shovel', name: 'Xẻng', category: 'melee', w: 6, h: 1, stance: 'melee', color: '#6b6653', info: 'Heavy shovel · sweeping strike' },
  long_sledgehammer: { id: 'long_sledgehammer', name: 'Búa tạ dài', category: 'melee', w: 7, h: 2, stance: 'melee', color: '#68615a', info: 'Slow heavy swing · wide cleave and stun' },
  quam: { id: 'quam', name: 'Cây Quắm', category: 'melee', w: 7, h: 1, stance: 'melee', color: '#5a4630', info: 'Polearm hook blade · long reach, heavy cut' },
  flashlight: { id: 'flashlight', name: 'Đèn pin', category: 'tool', w: 2, h: 1, stance: 'unarmed', color: '#3a3f44', info: 'Off-hand tool · lights up the way ahead at night (turns on by itself)' },
  medkit: { id: 'medkit', name: 'Hộp cứu thương', category: 'medical', w: 2, h: 1, stance: 'unarmed', color: '#8a2a2a', info: 'Restores full health · 3 uses · 5 s to apply, interrupted by moving or damage', uses: 3 },
  potato: { id: 'potato', name: 'Khoai tây', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#8a6a3a', info: 'Raw potato · plant it, cook it, or right-click to eat raw (little filling)' },
  potato_cooked: { id: 'potato_cooked', name: 'Khoai tây nướng', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#a8743a', info: 'Cooked potato · right-click to eat' },
  raw_mutton: { id: 'raw_mutton', name: 'Thịt cừu sống', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#9a3a3a', info: 'Raw meat from a sheep · cook it on a campfire (raw: little filling)' },
  raw_porkchop: { id: 'raw_porkchop', name: 'Thịt lợn rừng sống', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#a84a4a', info: 'Raw meat from a boar · cook it on a campfire (raw: little filling)' },
  cooked_mutton: { id: 'cooked_mutton', name: 'Thịt cừu chín', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#7a4a2a', info: 'Hearty cooked meat · right-click to eat' },
  cooked_porkchop: { id: 'cooked_porkchop', name: 'Thịt lợn rừng chín', category: 'food', w: 1, h: 1, stance: 'unarmed', color: '#8a5a2a', info: 'Cooked meat · right-click to eat' },
  nuclear_cell: { id: 'nuclear_cell', name: 'Pin năng lượng hạt nhân', category: 'resource', w: 1, h: 2, stance: 'unarmed', color: '#3a6a3a', info: 'Energy cell salvaged from industrial ruins' },
  coal_carton: { id: 'coal_carton', name: 'Thùng than', category: 'resource', w: 2, h: 2, uses: 2, stance: 'unarmed', color: '#3a3a3a', info: 'Nhấn chuột phải để đặt than cháy · 2 lần sử dụng · nướng đồ ăn trong 10 phút' },
  grenade: { id: 'grenade', name: 'Lựu đạn', category: 'grenade', w: 1, h: 1, stance: 'grenade', color: '#56663f', info: 'Frag grenade' },
  c4: { id: 'c4', name: 'C4 điều khiển từ xa', category: 'grenade', w: 2, h: 1, stance: 'grenade', color: '#687048', info: 'Chuột phải: ném tầm ngắn · bám địa hình và mob · chuột trái: kích nổ' },
  c4_detonator: { id: 'c4_detonator', name: 'Bộ kích nổ C4', category: 'grenade', w: 2, h: 1, stance: 'grenade', color: '#687048', info: 'C4 đã được ném · cầm bộ kích nổ rồi nhấn chuột trái để kích nổ' },
  ammo_762: { id: 'ammo_762', name: '7.62×39', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6e5a32', info: 'AK-47 ammo box · 30 rounds', ammo: { guns: ['ak47'], capacity: 30 } },
  ammo_556: { id: 'ammo_556', name: '5.56 NATO', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#5d6440', info: 'M4A1 / AUG / SCAR-L / Mini-14 ammo box · 30 rounds', ammo: { guns: ['m4a1', 'aug', 'scar_l', 'mini14'], capacity: 30 } },
  ammo_762x54: { id: 'ammo_762x54', name: '7.62×54R', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6a4b30', info: 'SVD / Kar98k ammo box · 20 rounds', ammo: { guns: ['svd', 'kar98k'], capacity: 20 } },
  ammo_57x28: { id: 'ammo_57x28', name: '5.7×28', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#4f5c4a', info: 'P90 ammo box · 50 rounds', ammo: { guns: ['p90'], capacity: 50 } },
  // Weapon attachments: installed through the attachment screen (Alt / right-click a gun).
  red_dot: { id: 'red_dot', name: 'Ống ngắm điểm đỏ', category: 'attachment', w: 1, h: 1, stance: 'unarmed', color: '#3c3f44', info: 'Red dot sight · 1× · fast target pickup' },
  holo_sight: { id: 'holo_sight', name: 'Ống ngắm toàn ảnh', category: 'attachment', w: 1, h: 1, stance: 'unarmed', color: '#34373a', info: 'Holographic sight · 1× · ring-and-dot reticle' },
  scope_2x: { id: 'scope_2x', name: 'Ống ngắm 2×', category: 'attachment', w: 2, h: 1, stance: 'unarmed', color: '#3a3d38', info: 'Low-power scope · 2× · duplex reticle' },
  scope_4x: { id: 'scope_4x', name: 'Ống ngắm 4×', category: 'attachment', w: 2, h: 1, stance: 'unarmed', color: '#363a34', info: 'Combat scope · 4× · duplex reticle' },
  nv_scope_6x: { id: 'nv_scope_6x', name: 'Ống ngắm nhìn đêm 6×', category: 'attachment', w: 3, h: 1, stance: 'unarmed', color: '#2f4430', info: 'Night-vision scope · 6× · M / mouse wheel switches night vision' },
  scope_8x: { id: 'scope_8x', name: 'Ống ngắm 8×', category: 'attachment', w: 3, h: 1, stance: 'unarmed', color: '#33363a', info: 'Sniper scope · 8× · mil-dot reticle' },
  scope_10x: { id: 'scope_10x', name: 'Ống ngắm 10×', category: 'attachment', w: 3, h: 1, stance: 'unarmed', color: '#2e3134', info: 'Long-range scope · 10× · mil-dot reticle' },
  suppressor_pistol: { id: 'suppressor_pistol', name: 'Giảm thanh súng ngắn', category: 'attachment', w: 2, h: 1, stance: 'unarmed', color: '#2b2d30', info: 'Pistol / SMG suppressor · quieter, no flash, less recoil' },
  suppressor_rifle: { id: 'suppressor_rifle', name: 'Giảm thanh súng trường', category: 'attachment', w: 2, h: 1, stance: 'unarmed', color: '#2a2c2e', info: 'Rifle suppressor · quieter, no flash, less recoil' },
  ammo_762x51: { id: 'ammo_762x51', name: '7.62×51 NATO', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#5e5236', info: 'SCAR-H ammo box · 20 rounds', ammo: { guns: ['scar_h'], capacity: 20 } },
  ammo_300wm: { id: 'ammo_300wm', name: '.300 WM', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#55603e', info: 'AWM ammo box · 15 rounds', ammo: { guns: ['awm'], capacity: 15 } },
  ammo_9mm: { id: 'ammo_9mm', name: '9×19', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#4d5864', info: 'GL18 / MP5 / UZI / Vector ammo box · 30 rounds', ammo: { guns: ['gl18', 'mp5', 'uzi', 'vector'], capacity: 30 } },
  ammo_357: { id: 'ammo_357', name: '.357 Magnum', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#6a5f50', info: 'Revolver / Desert Eagle ammo box · 18 rounds', ammo: { guns: ['revolver', 'deagle'], capacity: 18 } },
  ammo_12g: { id: 'ammo_12g', name: '12 ga', category: 'ammo', w: 1, h: 1, stance: 'unarmed', color: '#7a3a30', info: 'Shotgun shells · 6 rounds', ammo: { guns: ['shotgun', 'saiga12', 'double_barrel'], capacity: 6 } },
  ammo_40mm: { id: 'ammo_40mm', name: 'Đạn 40 mm', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#606a3a', info: 'Grenade launcher pack · 6 rounds', ammo: { guns: ['grenade_launcher'], capacity: 6 } },
  rocket: { id: 'rocket', name: 'Đạn tên lửa', category: 'ammo', w: 2, h: 1, stance: 'unarmed', color: '#5a5a40', info: 'One rocket for the launcher', ammo: { guns: ['rocket_launcher'], capacity: 1 } },
  bolts: { id: 'bolts', name: 'Ống tên nỏ', category: 'ammo', w: 1, h: 2, stance: 'unarmed', color: '#4a3c2c', info: 'Crossbow bolts · 10', ammo: { guns: ['crossbow'], capacity: 10 } },
  fuel_tank: { id: 'fuel_tank', name: 'Bình nhiên liệu', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#8a3a24', info: 'Flamethrower fuel · 100 units', ammo: { guns: ['flamethrower'], capacity: 100 } },
  ammo_pkm: { id: 'ammo_pkm', name: 'Hộp đạn PKM 7.62×54R', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#53613d', info: 'Dây đạn 7.62×54R cho PKM · 100 viên', ammo: { guns: ['pkm'], capacity: 100 } },
  ammo_50bmg: { id: 'ammo_50bmg', name: 'Hộp đạn .50 BMG', category: 'ammo', w: 2, h: 2, stance: 'unarmed', color: '#756441', info: 'Đạn Barrett M82 · 10 viên', ammo: { guns: ['barrett'], capacity: 10 } },
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
  attachment: 'Attachment',
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
