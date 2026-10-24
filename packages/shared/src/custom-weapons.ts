import { z } from 'zod';
import { WEAPON_ATTACHMENTS, ATTACHMENTS } from './attachments';
import { ITEMS, type ItemCategory, type ItemDef } from './items';
import { SHOP_STOCK, registerShopEntry, type ShopEntry } from './shop';
import { type ThrowSpec, ITEM_BY_WEAPON, WEAPON_BY_ITEM, WEAPON_SPECS, type GunSpec, type MeleeSpec, type WeaponId } from './weapons';

/**
 * Weapons created in the Studio: a model (GLB / Blockbench) plus everything the game needs to
 * hold, aim, fire and sell it. Stored by the server, sent to every client before it loads its
 * weapon models, and registered into the same tables as the built-in weapons.
 */
export const CUSTOM_WEAPON_ID_MIN = 100;
export const CUSTOM_WEAPON_ID_MAX = 250;

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const id = z.string().regex(/^[a-z0-9_]{2,33}$/);

/**
 * The built-in arsenal as shipped (before any Studio edits): spec, item, ammo box, attachments
 * and shop listing per weapon. Built-ins are edited in the Studio as overrides on top of this and
 * "deleting" one restores it.
 */
interface BuiltinWeapon { weaponId: WeaponId; spec: GunSpec | MeleeSpec | ThrowSpec; item: ItemDef; ammo: string | null; attachments: Partial<Record<'optic' | 'muzzle', readonly string[]>> | undefined; shop: ShopEntry | undefined }
const BUILTIN = new Map<string, BuiltinWeapon>();
for (const [itemId, wid] of Object.entries(WEAPON_BY_ITEM)) {
  const spec = WEAPON_SPECS[wid as Exclude<WeaponId, 0>];
  // Hand grenades are editable too; the remote C4 (and its detonator) is not.
  if (!spec || (spec.kind === 'throw' && spec.remote) || !ITEMS[itemId] || itemId === 'c4_detonator' || itemId === 'c4') continue;
  BUILTIN.set(itemId, {
    weaponId: wid, spec: structuredClone(spec), item: structuredClone(ITEMS[itemId]!),
    ammo: Object.values(ITEMS).find((d) => d.ammo?.guns.includes(itemId))?.id ?? null,
    attachments: WEAPON_ATTACHMENTS[itemId] ? structuredClone(WEAPON_ATTACHMENTS[itemId]) as BuiltinWeapon['attachments'] : undefined,
    shop: SHOP_STOCK.find((e) => e.item === itemId),
  });
}
/** Item ids of the built-in weapons the Studio can edit. */
export function builtinWeaponIds(): string[] { return [...BUILTIN.keys()]; }
export function isBuiltinWeapon(itemId: string): boolean { return BUILTIN.has(itemId); }

/**
 * A built-in weapon as an editable definition (stats from the shared tables). The model points
 * are filled in by the client, which owns the visual table; `fallback` supplies them.
 */
export function builtinWeaponDraft(itemId: string, model: CustomWeapon['model'], format: 'glb' | 'bbmodel', recoil = 1): CustomWeapon | null {
  const b = BUILTIN.get(itemId);
  if (!b) return null;
  const s = b.spec;
  const category = (['pistol', 'smg', 'rifle', 'shotgun', 'heavy', 'melee', 'grenade'] as const).find((c) => c === b.item.category) ?? (s.kind === 'melee' ? 'melee' : s.kind === 'throw' ? 'grenade' : 'rifle');
  return {
    id: itemId, weaponId: b.weaponId, name: b.item.name, info: b.item.info.slice(0, 120), kind: s.kind === 'melee' ? 'melee' : s.kind === 'throw' ? 'throw' : 'gun', format,
    item: { category, w: b.item.w, h: b.item.h, color: /^#[0-9a-fA-F]{6}$/.test(b.item.color) ? b.item.color : '#5a5a52' },
    model,
    ...(s.kind === 'gun' ? { gun: {
      damage: Math.max(1, s.damage), pellets: s.pellets, fireMs: s.fireMs, spread: s.spread, range: s.range, magazine: s.magazine, reloadMs: s.reloadMs, auto: s.auto, weight: s.weight,
      recoil, ammo: b.ammo ?? 'ammo_556', sound: 'default' as const, optics: [...(b.attachments?.optic ?? [])], muzzleDevices: [...(b.attachments?.muzzle ?? [])],
    } } : {}),
    ...(s.kind === 'throw' ? { throw: { damage: s.damage, radius: s.radius, fuseMs: s.fuseMs, cooldownMs: s.cooldownMs, maxRange: s.maxRange, weight: s.weight, effect: s.effect ?? 'frag', effectMs: s.effectMs ?? 0 } } : {}),
    ...(s.kind === 'melee' ? { melee: { damage: s.damage, range: s.range, cooldownMs: s.cooldownMs, swingMs: s.swingMs, weight: s.weight, ...(s.decapitationChance ? { decapitationChance: s.decapitationChance } : {}) } } : {}),
    price: b.shop?.price ?? 0, lootable: false,
  };
}

/** Shot sounds a custom gun may use (existing recordings). */
export const CUSTOM_GUN_SOUNDS = ['default', 'pistol9mmShot', 'magnumShot', 'rifleShot', 'akShot', 'sniperRifleShot', 'shotgunShot', 'pumpShot', 'pkmShot', 'barrettShot'] as const;

export const customWeaponSchema = z.object({
  id,
  /** WeaponId on the wire: 100…250 for new weapons (assigned by the server), the built-in id otherwise. */
  weaponId: z.number().int().min(1).max(CUSTOM_WEAPON_ID_MAX),
  name: z.string().trim().min(2).max(40),
  info: z.string().trim().max(120).default(''),
  kind: z.enum(['gun', 'melee', 'throw']),
  format: z.enum(['glb', 'bbmodel']),
  /** Inventory footprint, category and tile colour. */
  item: z.object({
    category: z.enum(['pistol', 'smg', 'rifle', 'shotgun', 'heavy', 'melee', 'grenade']),
    w: z.number().int().min(1).max(8),
    h: z.number().int().min(1).max(3),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5a5a52'),
  }),
  /**
   * How the model is held, in the model's own units (Blockbench pixels / GLB units): `barrel`
   * (toward the target), `up`, `grip` (firing hand), and the optional points below.
   */
  model: z.object({
    /**
     * Built-ins: the shipped model file these points (and an uploaded model) were made for. When
     * the game ships a new model the override no longer matches and the shipped visual is used.
     */
    base: z.string().max(200).optional(),
    length: z.number().min(.1).max(3),
    barrel: vec3,
    up: vec3,
    grip: vec3,
    support: vec3.optional(),
    muzzle: vec3.optional(),
    eject: vec3.optional(),
    sight: z.object({ rear: vec3, front: vec3 }).optional(),
    rail: vec3.optional(),
    edge: vec3.optional(),
    strikePoint: vec3.optional(),
    /** First-person view: hip offset (x right, y up, z forward, metres) and ADS eye relief. */
    fpHip: vec3.optional(),
    fpEyeRelief: z.number().min(.1).max(.8).optional(),
    /** First-person view: shift of the support (left) hand from where it holds (metres; x forward, y up, z right). */
    fpSupport: vec3.optional(),
    /** First-person view: hip tilt, pitch (up/down) and yaw (left/right), radians. */
    /** Size of mounted optics / muzzle devices on this gun (1 = default). */
    opticScale: z.number().min(.3).max(3).optional(),
    muzzleScale: z.number().min(.3).max(3).optional(),
    /** Size of one particular attachment on this gun (wins over the slot size). */
    attachmentScale: z.record(z.string().max(40), z.number().min(.2).max(5)).optional(),
    /** Shift of the attachment point for one particular attachment on this gun (model units). */
    attachmentOffset: z.record(z.string().max(40), vec3).optional(),
    fpRot: z.tuple([z.number().min(-1.2).max(1.2), z.number().min(-1.2).max(1.2)]).optional(),
    /** Size multiplier set in the Studio, on top of the length and any fitting in the file (1 = as is). */
    size: z.number().min(.2).max(5).optional(),
  }),
  gun: z.object({
    damage: z.number().min(0).max(300),
    pellets: z.number().int().min(1).max(16),
    fireMs: z.number().int().min(40).max(4000),
    spread: z.number().min(0).max(.4),
    range: z.number().min(5).max(250),
    magazine: z.number().int().min(1).max(200),
    reloadMs: z.number().int().min(300).max(8000),
    auto: z.boolean(),
    weight: z.number().min(.2).max(20),
    /** First-person kick per shot (degrees). */
    recoil: z.number().min(0).max(8),
    /** Ammo box item that loads it. */
    ammo: z.string().min(1).max(40),
    sound: z.enum(CUSTOM_GUN_SOUNDS),
    optics: z.array(z.string()).max(12).default([]),
    muzzleDevices: z.array(z.string()).max(4).default([]),
  }).optional(),
  melee: z.object({
    damage: z.number().min(1).max(300),
    range: z.number().min(1).max(5),
    cooldownMs: z.number().int().min(200).max(4000),
    swingMs: z.number().int().min(100).max(3000),
    weight: z.number().min(.2).max(20),
    decapitationChance: z.number().min(0).max(1).optional(),
  }).optional(),
  /** Hand grenades: blast, stun (blinds and deafens) or smoke. */
  throw: z.object({
    damage: z.number().min(0).max(500),
    radius: z.number().min(1).max(40),
    fuseMs: z.number().int().min(300).max(10000),
    cooldownMs: z.number().int().min(200).max(5000),
    maxRange: z.number().min(3).max(60),
    weight: z.number().min(.1).max(5),
    effect: z.enum(['frag', 'flash', 'smoke']),
    /** Stun: longest blindness (ms). Smoke: how long the cloud lasts (ms). */
    effectMs: z.number().int().min(0).max(60000),
  }).optional(),
  price: z.number().int().min(0).max(100000),
  /** Can turn up in chests and battle royale crates. */
  lootable: z.boolean().default(false),
}).strict().superRefine((w, ctx) => {
  const builtin = BUILTIN.get(w.id);
  if (builtin) {
    if (w.weaponId !== builtin.weaponId) ctx.addIssue({ code: 'custom', message: 'Không đổi được mã của vũ khí có sẵn' });
    if (w.kind !== (builtin.spec.kind === 'melee' ? 'melee' : builtin.spec.kind === 'throw' ? 'throw' : 'gun')) ctx.addIssue({ code: 'custom', message: 'Không đổi được loại của vũ khí có sẵn' });
  } else {
    if (!/^cw_[a-z0-9_]{2,30}$/.test(w.id)) ctx.addIssue({ code: 'custom', message: 'Mã vũ khí mới phải bắt đầu bằng cw_' });
    if (w.weaponId < CUSTOM_WEAPON_ID_MIN) ctx.addIssue({ code: 'custom', message: 'Mã số vũ khí mới phải từ 100' });
    if (w.gun?.sound === 'default') ctx.addIssue({ code: 'custom', message: 'Chọn tiếng súng' });
  }
  if (w.kind === 'gun' && !w.gun) ctx.addIssue({ code: 'custom', message: 'Súng cần cấu hình bắn' });
  if (w.kind === 'melee' && !w.melee) ctx.addIssue({ code: 'custom', message: 'Vũ khí cận chiến cần cấu hình' });
  if (w.kind === 'throw' && !w.throw) ctx.addIssue({ code: 'custom', message: 'Lựu đạn cần cấu hình' });
  if (w.kind === 'gun' && !w.model.muzzle) ctx.addIssue({ code: 'custom', message: 'Súng cần điểm đầu nòng' });
  if (w.gun?.optics.length && !w.model.rail) ctx.addIssue({ code: 'custom', message: 'Chọn ống ngắm lắp được thì cần đặt điểm Ngàm ống ngắm' });
  if (w.gun && !ITEMS[w.gun.ammo]?.ammo) ctx.addIssue({ code: 'custom', message: `Hộp đạn không tồn tại: ${w.gun.ammo}` });
  for (const a of [...(w.gun?.optics ?? []), ...(w.gun?.muzzleDevices ?? [])]) if (!ATTACHMENTS[a]) ctx.addIssue({ code: 'custom', message: `Phụ kiện không tồn tại: ${a}` });
});
export type CustomWeapon = z.infer<typeof customWeaponSchema>;

/** Public listing: definitions plus where the model is served. */
export interface CustomWeaponList { weapons: Array<CustomWeapon & { modelUrl: string | null }> }

/** Ammo boxes a custom gun may load (from the built-in item table). */
export function ammoItems(): string[] {
  return Object.values(ITEMS).filter((d) => d.ammo).map((d) => d.id);
}

const registered = new Set<string>();
const lootable = new Set<string>();

/**
 * Adds (or replaces) a custom weapon in every shared table: weapon spec, item, ids, attachments,
 * ammo compatibility and the shop. Same effect on the server and every client.
 */
export function registerCustomWeapon(w: CustomWeapon): void {
  const wid = w.weaponId as WeaponId;
  const builtin = BUILTIN.get(w.id);
  const specs = WEAPON_SPECS as Record<number, GunSpec | MeleeSpec | ThrowSpec>;
  // Built-ins keep what the Studio does not edit (projectiles, flame, melee swing shape…).
  const base = builtin ? structuredClone(builtin.spec) : {};
  specs[wid] = w.kind === 'throw' && w.throw
    ? { ...{ speed: 14, elevation: .62, scatterBase: 1, scatterPerM: .07 }, ...base as Partial<ThrowSpec>, kind: 'throw', weight: w.throw.weight, damage: w.throw.damage, radius: w.throw.radius, fuseMs: w.throw.fuseMs, cooldownMs: w.throw.cooldownMs, maxRange: w.throw.maxRange, effect: w.throw.effect, effectMs: w.throw.effectMs }
    : w.kind === 'gun' && w.gun
    ? { ...base as GunSpec, kind: 'gun', weight: w.gun.weight, fireMs: w.gun.fireMs, damage: w.gun.damage, pellets: w.gun.pellets, spread: w.gun.spread, range: w.gun.range, magazine: w.gun.magazine, reloadMs: w.gun.reloadMs, auto: w.gun.auto, recoil: w.gun.recoil, ...(w.gun.sound !== 'default' ? { sound: w.gun.sound } : {}) }
    : { ...base as MeleeSpec, kind: 'melee', weight: w.melee!.weight, damage: w.melee!.damage, range: w.melee!.range, cooldownMs: w.melee!.cooldownMs, swingMs: w.melee!.swingMs, ...(w.melee!.decapitationChance ? { decapitationChance: w.melee!.decapitationChance } : {}) };
  (WEAPON_BY_ITEM as Record<string, WeaponId>)[w.id] = wid;
  (ITEM_BY_WEAPON as Record<number, string>)[wid] = w.id;
  const category: ItemCategory = w.item.category;
  ITEMS[w.id] = { ...(builtin ? structuredClone(builtin.item) : {}), id: w.id, name: w.name, category, w: w.item.w, h: w.item.h, stance: builtin?.item.stance ?? (w.kind === 'throw' ? 'grenade' : w.kind === 'melee' ? 'melee' : category === 'pistol' ? 'pistol' : 'rifle'), color: w.item.color, info: w.info || (w.kind === 'gun' ? 'Vũ khí tầm xa' : w.kind === 'throw' ? 'Lựu đạn' : 'Vũ khí cận chiến') };
  // Ammo: the chosen box now also loads this gun.
  for (const d of Object.values(ITEMS)) if (d.ammo) d.ammo.guns = d.ammo.guns.filter((g) => g !== w.id);
  if (w.gun) ITEMS[w.gun.ammo]?.ammo?.guns.push(w.id);
  const slots = WEAPON_ATTACHMENTS as Record<string, Partial<Record<'optic' | 'muzzle', readonly string[]>>>;
  if (w.gun && (w.gun.optics.length || w.gun.muzzleDevices.length)) slots[w.id] = { ...(w.gun.optics.length ? { optic: w.gun.optics } : {}), ...(w.gun.muzzleDevices.length ? { muzzle: w.gun.muzzleDevices } : {}) };
  else delete slots[w.id];
  registerShopEntry({ ...(builtin?.shop ?? {}), item: w.id, price: w.price, category: builtin?.shop?.category ?? (w.kind === 'throw' ? 'explosives' : w.kind === 'melee' ? 'melee' : category === 'heavy' ? 'heavy' : 'guns') });
  registered.add(w.id);
  if (w.lootable) lootable.add(w.id); else lootable.delete(w.id);
}

/** Removes a custom weapon from every table (deleted in the Studio). */
export function unregisterCustomWeapon(itemId: string): void {
  const builtin = BUILTIN.get(itemId);
  if (builtin) {
    // A built-in goes back to how it shipped.
    (WEAPON_SPECS as Record<number, GunSpec | MeleeSpec | ThrowSpec>)[builtin.weaponId] = structuredClone(builtin.spec);
    ITEMS[itemId] = structuredClone(builtin.item);
    for (const d of Object.values(ITEMS)) if (d.ammo) d.ammo.guns = d.ammo.guns.filter((g) => g !== itemId);
    if (builtin.ammo) ITEMS[builtin.ammo]?.ammo?.guns.push(itemId);
    const slots = WEAPON_ATTACHMENTS as Record<string, BuiltinWeapon['attachments']>;
    if (builtin.attachments) slots[itemId] = structuredClone(builtin.attachments); else delete slots[itemId];
    if (builtin.shop) registerShopEntry(builtin.shop); else registerShopEntry({ item: itemId, price: 0, category: 'guns' }, true);
    registered.delete(itemId); lootable.delete(itemId);
    return;
  }
  const wid = WEAPON_BY_ITEM[itemId];
  if (wid !== undefined) {
    delete (WEAPON_SPECS as Record<number, unknown>)[wid];
    delete (ITEM_BY_WEAPON as Record<number, string>)[wid];
  }
  delete (WEAPON_BY_ITEM as Record<string, WeaponId>)[itemId];
  delete ITEMS[itemId];
  delete (WEAPON_ATTACHMENTS as Record<string, unknown>)[itemId];
  for (const d of Object.values(ITEMS)) if (d.ammo) d.ammo.guns = d.ammo.guns.filter((g) => g !== itemId);
  registerShopEntry({ item: itemId, price: 0, category: 'guns' }, true);
  registered.delete(itemId);
}

export function isCustomWeapon(itemId: string): boolean { return registered.has(itemId); }
export function customWeaponIds(): string[] { return [...registered]; }

/** Custom guns marked lootable (chests and battle royale crates). */
export function lootableCustomWeapons(): string[] { return [...lootable].filter((id) => registered.has(id)); }
