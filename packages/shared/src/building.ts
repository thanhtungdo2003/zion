/**
 * Survival base building: raw resources (wood, stone, metal ores), the architect's blueprints, the
 * structures they place, and supply drops ordered by radio. Shared by the server (authority) and
 * the client (panels, hologram, prediction colliders).
 */
import type { VehicleKind } from './vehicles';

/* ------------------------------------ resources ---------------------------------------- */

/** Survival flora (island models) a fire axe fells, and the rocks a pickaxe mines. */
export const TREE_ASSETS: ReadonlySet<number> = new Set([2440, 2441, 2442, 2443, 2444, 2445, 2446, 2447, 2448, 2449, 2450, 2451, 2452, 2453, 2473]);
export const ROCK_ASSETS: ReadonlySet<number> = new Set([2463, 2464, 2465, 2466, 2467, 2468, 2469, 2470]);
/** Melee items that chop trees / mine rocks. */
export const CHOPPING_TOOLS: ReadonlySet<string> = new Set(['fire_axe']);
export const MINING_TOOLS: ReadonlySet<string> = new Set(['pickaxe']);

/** Identity of a world prop: chunk and its quantized spot (stable across reloads). */
export function propKey(cx: number, cz: number, lx: number, lz: number): string {
  return `${cx}:${cz}:${lx}:${lz}`;
}

/** Axe blows a tree takes (bigger trees take more). */
export function treeHits(scale: number): number {
  return Math.max(3, Math.min(7, Math.round(2 + scale * 2.4)));
}
/** Logs a felled trunk yields (picked up one at a time with F). */
export function treeLogs(scale: number): number {
  return Math.max(1, Math.min(4, Math.round(scale * 1.8)));
}
/** A felled tree's trunk lies this long; the tree grows back later. */
export const TRUNK_LIFETIME_MS = 6 * 60_000;
export const TREE_REGROW_MS = 25 * 60_000;
/** Pickaxe blows a rock takes before it is spent, and how long until its face is workable again. */
export const ROCK_YIELD = 8;
export const ROCK_REGROW_MS = 15 * 60_000;
/** Reach for chopping, mining and gathering logs (m). */
export const GATHER_REACH = 3.2;

export type OreKind = 'stone' | 'iron' | 'copper' | 'lead';
/** What a rock is made of: most are plain stone; some carry an ore seam (decided by its spot). */
export function rockOre(key: string): OreKind {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  return r < .52 ? 'stone' : r < .78 ? 'iron' : r < .92 ? 'copper' : 'lead';
}
export const ORE_ITEM: Record<OreKind, string> = { stone: 'stone', iron: 'iron_ore', copper: 'copper_ore', lead: 'lead_ore' };
export const ORE_NAME: Record<OreKind, string> = { stone: 'Mỏ đá', iron: 'Mỏ sắt lộ thiên', copper: 'Mỏ đồng lộ thiên', lead: 'Mỏ chì lộ thiên' };
/** One pickaxe blow: the seam's ore most of the time, plain stone otherwise. */
export function mineDrop(ore: OreKind, random: () => number = Math.random): string {
  if (ore === 'stone') return 'stone';
  return random() < .6 ? ORE_ITEM[ore] : 'stone';
}

/** Hand crafting from the inventory (right-click): one log splits into four planks. */
export const CRAFTS: Record<string, { out: string; count: number; label: string }> = {
  wood_log: { out: 'plank', count: 4, label: 'Xẻ thành 4 tấm ván' },
};

/* ------------------------------------ structures --------------------------------------- */

export type BuildMaterial = 'wood' | 'stone' | 'metal';
/** Health of one wall panel by material: wood < stone < metal. */
export const MATERIAL_HP: Record<BuildMaterial, number> = { wood: 450, stone: 1400, metal: 3600 };
export type DamageKind = 'bullet' | 'melee' | 'blast' | 'brute';
/** Share of a hit's damage a material takes (explosives are what breaks a base). */
export const MATERIAL_RESIST: Record<BuildMaterial, Record<DamageKind, number>> = {
  wood: { bullet: .6, melee: 1, blast: 3, brute: 1 },
  stone: { bullet: .25, melee: .3, blast: 2.2, brute: .8 },
  metal: { bullet: .1, melee: .15, blast: 1.6, brute: .6 },
};
export const MATERIAL_COLOR: Record<BuildMaterial, string> = { wood: '#8a6440', stone: '#8b8a84', metal: '#5d6670' };
/** A brute (big zombie) blow against a wall. */
export const BRUTE_STRUCTURE_DAMAGE = 90;
export const BRUTE_STRUCTURE_COOLDOWN_MS = 1600;

export type PieceKind = 'wall' | 'door' | 'roof' | 'core' | 'pillar';
/** One box of a structure in its local frame (−Z = front, door side), centre and half sizes. */
export interface StructurePiece { kind: PieceKind; x: number; y: number; z: number; hx: number; hy: number; hz: number; hp: number }

export interface BlueprintDef {
  id: string;
  /** Inventory item that places it. */
  item: string;
  name: string;
  description: string;
  material: BuildMaterial;
  /** Footprint (m) and wall height. */
  w: number; d: number; h: number;
  thickness: number;
  /** Resources the architect wants (item → units). */
  cost: Record<string, number>;
}

export const BLUEPRINTS: readonly BlueprintDef[] = [
  { id: 'wood_outpost', item: 'bp_wood_outpost', name: 'Trạm gác gỗ', description: 'Nhà gỗ 8 × 8 m, khe bắn ở hai bên, mái che. Lõi pin hạt nhân thắp sáng bên trong.', material: 'wood', w: 8, d: 8, h: 3, thickness: .2, cost: { plank: 32, stone: 10 } },
  { id: 'stone_bunker', item: 'bp_stone_bunker', name: 'Hầm đá kiên cố', description: 'Lô cốt đá 10 × 10 m, tường dày 40 cm, khe bắn bốn phía. Chịu được zombie lớn lâu hơn nhiều.', material: 'stone', w: 10, d: 10, h: 3.2, thickness: .4, cost: { stone: 60, plank: 16, iron_ore: 8, nuclear_cell: 1 } },
  { id: 'metal_fortress', item: 'bp_metal_fortress', name: 'Pháo đài thép', description: 'Pháo đài 12 × 12 m bọc thép, cột góc gia cố, cổng đôi. Chỉ thuốc nổ mới phá được nhanh.', material: 'metal', w: 12, d: 12, h: 3.6, thickness: .3, cost: { iron_ore: 40, copper_ore: 16, lead_ore: 10, stone: 30, nuclear_cell: 2 } },
];
export const BLUEPRINT_BY_ITEM: ReadonlyMap<string, BlueprintDef> = new Map(BLUEPRINTS.map((b) => [b.item, b]));
export const BLUEPRINT_BY_ID: ReadonlyMap<string, BlueprintDef> = new Map(BLUEPRINTS.map((b) => [b.id, b]));

/** Walls start this far below the footprint's highest corner, so they meet sloping ground. */
export const STRUCTURE_SINK = .9;
const SLIT_LOW = 1.45, SLIT_HIGH = 1.85;

/** The boxes a blueprint builds, in its local frame (origin = footprint centre at floor level). */
export function blueprintPieces(def: BlueprintDef): StructurePiece[] {
  const out: StructurePiece[] = [];
  const hp = MATERIAL_HP[def.material], t = def.thickness, h = def.h, base = -STRUCTURE_SINK;
  const wall = (x: number, z: number, hx: number, hz: number, y0: number, y1: number, kind: PieceKind = 'wall', k = 1) =>
    out.push({ kind, x, y: (y0 + y1) / 2, z, hx, hy: (y1 - y0) / 2, hz, hp: Math.round(hp * k) });
  // Four sides, cut into ~2 m panels; the middle panel of the front is the door, the middle ones
  // of the other sides carry a firing slit (a gap too narrow to climb through).
  const sides: Array<{ len: number; at: (s: number) => [number, number]; along: 'x' | 'z'; front: boolean }> = [
    { len: def.w, at: (s) => [s, -def.d / 2 + t / 2], along: 'x', front: true },
    { len: def.w, at: (s) => [s, def.d / 2 - t / 2], along: 'x', front: false },
    { len: def.d - 2 * t, at: (s) => [-def.w / 2 + t / 2, s], along: 'z', front: false },
    { len: def.d - 2 * t, at: (s) => [def.w / 2 - t / 2, s], along: 'z', front: false },
  ];
  for (const side of sides) {
    const n = Math.max(3, Math.round(side.len / 2)), seg = side.len / n, mid = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const s = -side.len / 2 + seg * (i + .5);
      const [x, z] = side.at(s);
      const hx = side.along === 'x' ? seg / 2 : t / 2, hz = side.along === 'z' ? seg / 2 : t / 2;
      if (side.front && i === mid) {
        // Door leaf (opens for the owner) and the lintel above it.
        wall(x, z, hx, hz, 0, 2.5, 'door', .8);
        wall(x, z, hx, hz, 2.5, h);
        wall(x, z, hx, hz, base, 0);
      } else if (!side.front && (i === mid || (def.material !== 'wood' && (i === 1 || i === n - 2)))) {
        wall(x, z, hx, hz, base, SLIT_LOW);
        wall(x, z, hx, hz, SLIT_HIGH, h);
      } else wall(x, z, hx, hz, base, h);
    }
  }
  if (def.material === 'metal') for (const sx of [-1, 1]) for (const sz of [-1, 1]) wall(sx * (def.w / 2 - .25), sz * (def.d / 2 - .25), .35, .35, base, h + .6, 'pillar', 1.4);
  // Roof slabs (2 × 2 m tiles over the whole footprint).
  const nx = Math.max(2, Math.round(def.w / 3)), nz = Math.max(2, Math.round(def.d / 3));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const sx = def.w / nx, sz = def.d / nz;
    out.push({ kind: 'roof', x: -def.w / 2 + sx * (i + .5), y: h + .12, z: -def.d / 2 + sz * (j + .5), hx: sx / 2, hy: .12, hz: sz / 2, hp: Math.round(hp * .7) });
  }
  // The nuclear power core against the back wall.
  out.push({ kind: 'core', x: 0, y: .6, z: def.d / 2 - t - .55, hx: .35, hy: .6, hz: .35, hp: 800 });
  return out;
}

/** Can't use a blueprint this close to the main camp's centre (m). */
export const CAMP_BUILD_EXCLUSION = 100;
/** Structures one player may own at a time, and the reach to toggle a door. */
export const MAX_STRUCTURES_PER_PLAYER = 4;
export const DOOR_REACH = 3;
/** Footprint corners may differ this much in height. */
export const MAX_BUILD_SLOPE = 1.6;
/** The placement point sits this far ahead of the player (plus half the footprint). */
export const PLACE_DISTANCE = 3;

/** Where a structure would stand: in front of a player looking along `yaw`, rotated by `rot`. */
export function placementPoint(def: BlueprintDef, x: number, z: number, yaw: number): { x: number; z: number } {
  const d = PLACE_DISTANCE + Math.max(def.w, def.d) / 2;
  return { x: x - Math.sin(yaw) * d, z: z - Math.cos(yaw) * d };
}

/** Local → world for a structure rotated by `yaw` (three.js rotation.y convention). */
export function structureToWorld(sx: number, sz: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [sx + lx * c + lz * s, sz - lx * s + lz * c];
}

export interface StructureState {
  id: number;
  blueprint: string;
  owner: string;
  ownerName: string;
  x: number; y: number; z: number; yaw: number;
  /** Health per piece (index into blueprintPieces); 0 = destroyed. */
  hp: number[];
  /** Door pieces currently open. */
  open?: number[];
}

/** Structures use collider tags from here (tag = base + id × 64 + piece). */
export const STRUCTURE_TAG_BASE = 1_000_000;
export const structureOwner = (id: number): number => 0xc0000000 + id;

/** What the client is told about the architect's ledger for one blueprint. */
export interface BlueprintProgress { id: string; given: Record<string, number> }

/* ------------------------------------ supply drops ------------------------------------- */

export interface SupplyEntry {
  id: string;
  name: string;
  kind: 'vehicle' | 'weapons' | 'ammo';
  price: number;
  /** Crate contents (item id, how many). */
  items?: Array<[string, number]>;
  vehicle?: VehicleKind;
  icon: string;
}

export const SUPPLY_CATALOG: readonly SupplyEntry[] = [
  { id: 'veh_quad', name: 'Xe ATV địa hình', kind: 'vehicle', vehicle: 'quad', price: 1400, icon: 'game-icons:jeep' },
  { id: 'veh_car', name: 'Xe Lada', kind: 'vehicle', vehicle: 'car', price: 2200, icon: 'game-icons:city-car' },
  { id: 'veh_jeep', name: 'Xe Jeep quân sự', kind: 'vehicle', vehicle: 'jeep', price: 3200, icon: 'game-icons:jeep' },
  { id: 'veh_grizzly', name: 'Xe bọc thép Grizzly', kind: 'vehicle', vehicle: 'grizzly', price: 5200, icon: 'game-icons:apc' },
  { id: 'kit_assault', name: 'Gói tấn công AK-47', kind: 'weapons', price: 900, items: [['ak47', 1], ['ammo_762', 4], ['grenade', 2]], icon: 'game-icons:ak47' },
  { id: 'kit_marksman', name: 'Gói xạ thủ SVD', kind: 'weapons', price: 1500, items: [['svd', 1], ['scope_4x', 1], ['ammo_762x54', 3]], icon: 'game-icons:winchester-rifle' },
  { id: 'kit_breacher', name: 'Gói phá công sự', kind: 'weapons', price: 2100, items: [['rocket_launcher', 1], ['rocket', 3], ['c4', 2]], icon: 'game-icons:missile-launcher' },
  { id: 'kit_heavy', name: 'Gói súng máy PKM', kind: 'weapons', price: 2600, items: [['pkm', 1], ['ammo_pkm', 2]], icon: 'game-icons:machine-gun' },
  { id: 'ammo_rifle', name: 'Thùng đạn súng trường', kind: 'ammo', price: 380, items: [['ammo_762', 4], ['ammo_556', 4]], icon: 'game-icons:ammo-box' },
  { id: 'ammo_mixed', name: 'Thùng đạn tổng hợp', kind: 'ammo', price: 460, items: [['ammo_9mm', 3], ['ammo_12g', 3], ['ammo_357', 2], ['ammo_762x54', 2]], icon: 'game-icons:bullets' },
  { id: 'ammo_medical', name: 'Thùng y tế', kind: 'ammo', price: 420, items: [['medkit', 3], ['cooked_mutton', 4]], icon: 'game-icons:medical-pack' },
];
export const SUPPLY_BY_ID: ReadonlyMap<string, SupplyEntry> = new Map(SUPPLY_CATALOG.map((e) => [e.id, e]));

export const SUPPLY_FLIGHT = { altitude: 190, speed: 70, /** Crate fall speed under its canopy (m/s). */ sink: 6, approach: 900, cooldownMs: 90_000 } as const;
/** Radius of the cleared drop zone (red X) beside the camp. */
export const SUPPLY_ZONE_RADIUS = 14;

export interface SupplyPlane { id: number; x: number; z: number; y: number; yaw: number; owner: string; ownerName: string }
export interface SupplyCrateFall { id: number; kind: 'crate' | 'vehicle'; vehicle?: VehicleKind; x: number; y: number; z: number; landed: boolean }
export interface SupplyMessage { t: 'supply'; planes: SupplyPlane[]; drops: SupplyCrateFall[] }
