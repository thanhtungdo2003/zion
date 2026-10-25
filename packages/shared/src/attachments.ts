import { WEAPON_BY_ITEM, weaponSpec } from './weapons';

/**
 * Weapon attachments: data-driven slots, compatibility and stat modifiers. An attachment is an
 * ordinary inventory item until it is installed; then it lives on the gun item
 * (`PlacedItem.attachments[slot] = itemId`) and comes back as an item when removed.
 */
export type AttachmentSlot = 'optic' | 'muzzle';
export const ATTACHMENT_SLOTS: readonly AttachmentSlot[] = ['optic', 'muzzle'];

export type ReticleKind = 'dot' | 'holo' | 'duplex' | 'mildot' | 'rocket';

export interface AttachmentDef {
  id: string;
  slot: AttachmentSlot;
  /** Optics: magnification while aiming (1 = red dot, no zoom). */
  magnification?: number;
  reticle?: ReticleKind;
  /** Optics with a switchable night-vision mode. */
  nightVision?: boolean;
  /** Multipliers applied to the gun while installed (1 = unchanged). */
  modifiers: AttachmentModifiers;
}

export interface AttachmentModifiers {
  /** Bullet spread cone. */
  spread?: number;
  /** Camera / view-model kick per shot. */
  recoil?: number;
  /** How fast the gun comes up to the eye (ADS transition). */
  adsSpeed?: number;
  /** Distance at which the shot is heard. */
  loudness?: number;
  /** Whether the muzzle flash is visible. */
  flash?: number;
}

export const ATTACHMENTS: Record<string, AttachmentDef> = {
  red_dot: { id: 'red_dot', slot: 'optic', magnification: 1, reticle: 'dot', modifiers: { adsSpeed: 1 } },
  holo_sight: { id: 'holo_sight', slot: 'optic', magnification: 1, reticle: 'holo', modifiers: { adsSpeed: .95 } },
  scope_2x: { id: 'scope_2x', slot: 'optic', magnification: 2, reticle: 'duplex', modifiers: { adsSpeed: .9 } },
  scope_4x: { id: 'scope_4x', slot: 'optic', magnification: 4, reticle: 'duplex', modifiers: { adsSpeed: .8 } },
  nv_scope_6x: { id: 'nv_scope_6x', slot: 'optic', magnification: 6, reticle: 'mildot', nightVision: true, modifiers: { adsSpeed: .72 } },
  scope_8x: { id: 'scope_8x', slot: 'optic', magnification: 8, reticle: 'mildot', modifiers: { adsSpeed: .68 } },
  scope_10x: { id: 'scope_10x', slot: 'optic', magnification: 10, reticle: 'mildot', modifiers: { adsSpeed: .62 } },
  suppressor_pistol: { id: 'suppressor_pistol', slot: 'muzzle', modifiers: { recoil: .9, loudness: .3, flash: 0, spread: .95 } },
  suppressor_rifle: { id: 'suppressor_rifle', slot: 'muzzle', modifiers: { recoil: .88, loudness: .35, flash: 0, spread: .95 } },
  suppressor_sniper: { id: 'suppressor_sniper', slot: 'muzzle', modifiers: { recoil: .82, loudness: .3, flash: 0, spread: .93, adsSpeed: .95 } },
  compensator: { id: 'compensator', slot: 'muzzle', modifiers: { recoil: .8, spread: .97 } },
  compensator_rifle: { id: 'compensator_rifle', slot: 'muzzle', modifiers: { recoil: .78, spread: .96 } },
};

/** Stable order for the snapshot byte that tells other players what is mounted (index + 1). */
export const ATTACHMENT_ORDER: readonly string[] = ['red_dot', 'scope_2x', 'scope_4x', 'nv_scope_6x', 'scope_8x', 'scope_10x', 'suppressor_pistol', 'suppressor_rifle', 'holo_sight', 'suppressor_sniper', 'compensator', 'compensator_rifle'];

const SHORT_OPTICS = ['red_dot', 'holo_sight', 'scope_2x', 'scope_4x'];
const ALL_OPTICS = ['red_dot', 'holo_sight', 'scope_2x', 'scope_4x', 'nv_scope_6x', 'scope_8x', 'scope_10x'];
const LONG_OPTICS = ['scope_4x', 'nv_scope_6x', 'scope_8x', 'scope_10x'];
const PISTOL_CAN = ['suppressor_pistol', 'compensator'];
const RIFLE_CAN = ['suppressor_rifle', 'compensator_rifle'];
const SNIPER_CAN = ['suppressor_sniper', 'suppressor_rifle', 'compensator_rifle'];

/** Which attachments each gun (inventory item id) accepts, per slot. Guns not listed take none. */
export const WEAPON_ATTACHMENTS: Readonly<Record<string, Partial<Record<AttachmentSlot, readonly string[]>>>> = {
  gl18: { optic: ['red_dot'], muzzle: PISTOL_CAN },
  deagle: { optic: ['red_dot'], muzzle: PISTOL_CAN },
  mp5: { optic: ['red_dot', 'holo_sight', 'scope_2x'], muzzle: PISTOL_CAN },
  uzi: { optic: ['red_dot', 'holo_sight'], muzzle: PISTOL_CAN },
  // The Gen I model carries its own suppressor and holographic sight.
  vector: {},
  p90: { optic: ['red_dot'], muzzle: RIFLE_CAN },
  ak47: { optic: SHORT_OPTICS, muzzle: RIFLE_CAN },
  m4a1: { optic: ['red_dot', 'holo_sight'], muzzle: RIFLE_CAN },
  scar_l: { optic: [...SHORT_OPTICS, 'nv_scope_6x'], muzzle: RIFLE_CAN },
  m16: { optic: SHORT_OPTICS, muzzle: RIFLE_CAN },
  beryl: { optic: [...SHORT_OPTICS, 'nv_scope_6x'], muzzle: RIFLE_CAN },
  m762: { optic: [...SHORT_OPTICS, 'nv_scope_6x'], muzzle: RIFLE_CAN },
  aug: { optic: [...SHORT_OPTICS, 'nv_scope_6x'], muzzle: RIFLE_CAN },
  scar_h: { optic: [...SHORT_OPTICS, 'nv_scope_6x', 'scope_8x'], muzzle: RIFLE_CAN },
  mini14: { optic: ALL_OPTICS.slice(0, 6), muzzle: RIFLE_CAN },
  svd: { optic: LONG_OPTICS, muzzle: SNIPER_CAN },
  kar98k: { optic: LONG_OPTICS, muzzle: SNIPER_CAN },
  awm: { optic: LONG_OPTICS, muzzle: SNIPER_CAN },
  remington700: { optic: LONG_OPTICS, muzzle: SNIPER_CAN },
  barrett: { optic: ['nv_scope_6x', 'scope_8x', 'scope_10x'] },
  pkm: {},
  saiga12: { optic: ['red_dot', 'holo_sight'] },
};

export type Attachments = Partial<Record<AttachmentSlot, string>>;

export function attachmentDef(itemId: string | undefined): AttachmentDef | undefined {
  return itemId ? ATTACHMENTS[itemId] : undefined;
}

/** Can `attachment` go on `gun`? Returns the slot it would occupy, or null. */
export function compatibleSlot(gun: string, attachment: string): AttachmentSlot | null {
  const def = ATTACHMENTS[attachment];
  if (!def) return null;
  return WEAPON_ATTACHMENTS[gun]?.[def.slot]?.includes(attachment) ? def.slot : null;
}

/** Guns that accept a given attachment (shop "fits" lists). */
export function gunsFor(attachment: string): string[] {
  return Object.keys(WEAPON_ATTACHMENTS).filter((gun) => compatibleSlot(gun, attachment));
}

/** Drops unknown or incompatible entries (persisted / untrusted data). */
export function sanitizeAttachments(gun: string, raw: unknown): Attachments | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Attachments = {};
  for (const slot of ATTACHMENT_SLOTS) {
    const id = (raw as Record<string, unknown>)[slot];
    if (typeof id === 'string' && compatibleSlot(gun, id) === slot) out[slot] = id;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Combined multiplier of every installed attachment for one stat. */
export function attachmentModifier(attachments: Attachments | undefined, stat: keyof AttachmentModifiers): number {
  let m = 1;
  for (const slot of ATTACHMENT_SLOTS) {
    const v = attachmentDef(attachments?.[slot])?.modifiers[stat];
    if (v !== undefined) m *= v;
  }
  return m;
}

/** The installed optic (if any). */
/** Sights built into a weapon (no attachment slot): the rocket launcher's PGO-7 (2.7×, rangefinding). */
export const BUILTIN_OPTICS: Readonly<Record<string, AttachmentDef>> = {
  rocket_launcher: { id: 'scope_pgo7', slot: 'optic', magnification: 2.7, reticle: 'rocket', modifiers: {} },
};

/** The optic a weapon aims through: the fitted attachment, else its built-in sight. */
export function weaponOptic(itemId: string | null | undefined, attachments: Attachments | undefined): AttachmentDef | undefined {
  return attachmentDef(attachments?.optic) ?? (itemId ? BUILTIN_OPTICS[itemId] : undefined);
}

export function opticOf(attachments: Attachments | undefined): AttachmentDef | undefined {
  return attachmentDef(attachments?.optic);
}

/** One byte for snapshots: optic index (low nibble) and muzzle index (high nibble), 0 = none. */
export function packAttachments(attachments: Attachments | undefined): number {
  const index = (id?: string) => (id ? ATTACHMENT_ORDER.indexOf(id) + 1 : 0);
  return (index(attachments?.optic) & 15) | ((index(attachments?.muzzle) & 15) << 4);
}
export function unpackAttachments(byte: number): Attachments {
  const at = (n: number) => (n ? ATTACHMENT_ORDER[n - 1] : undefined);
  const out: Attachments = {};
  const optic = at(byte & 15), muzzle = at((byte >> 4) & 15);
  if (optic) out.optic = optic;
  if (muzzle) out.muzzle = muzzle;
  return out;
}

/** True for guns that can take any attachment at all. */
export function acceptsAttachments(gun: string): boolean {
  return !!WEAPON_ATTACHMENTS[gun] && weaponSpec(WEAPON_BY_ITEM[gun] ?? 0)?.kind === 'gun';
}
