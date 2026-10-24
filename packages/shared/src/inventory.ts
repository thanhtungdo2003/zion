import { ARMOR_BY_ID, ARMOR_SLOTS, NO_ARMOR, type ArmorLoadout, type ArmorSlot } from './armor';
import { ITEMS, maxCount, type ItemCategory, type ItemDef } from './items';
import { WEAPON_BY_ITEM, weaponSpec } from './weapons';
import { compatibleSlot, sanitizeAttachments, type AttachmentSlot, type Attachments } from './attachments';

/**
 * Grid inventory rules, shared by the server (which owns every player's inventory) and the client
 * (which shows it and predicts moves). Every container is a grid of cells; an item occupies w×h
 * cells (h×w when rotated) and a container only takes the categories it accepts.
 */
export interface ContainerDef {
  id: ContainerId;
  label: string;
  cols: number;
  rows: number;
  accepts: ItemCategory[] | 'all';
  /** Weapon slots appear on the hotbar; the backpack does not. */
  equip: boolean;
  /** Items may be rotated in here (weapon racks keep guns horizontal). */
  rotatable: boolean;
}

export type ContainerId = 'heavy' | 'primary' | 'secondary' | 'grenades' | 'backpack' | 'armor_head' | 'armor_chest' | 'armor_face' | 'armor_ears' | 'armor_legs' | 'armor_feet' | 'offhand' | 'pack' | 'pack_storage' | 'pack_rifle' | 'stash_1' | 'stash_2' | 'stash_3';

export const CONTAINERS: Record<ContainerId, ContainerDef> = {
  heavy: { id: 'heavy', label: 'Heavy', cols: 8, rows: 2, accepts: ['heavy', 'rifle', 'shotgun', 'melee'], equip: true, rotatable: false },
  primary: { id: 'primary', label: 'Primary · Rifle / Shotgun', cols: 6, rows: 2, accepts: ['rifle', 'shotgun'], equip: true, rotatable: false },
  secondary: { id: 'secondary', label: 'Secondary · Pistol / SMG', cols: 4, rows: 2, accepts: ['pistol', 'smg'], equip: true, rotatable: false },
  grenades: { id: 'grenades', label: 'Grenades', cols: 4, rows: 1, accepts: ['grenade'], equip: true, rotatable: false },
  backpack: { id: 'backpack', label: 'Backpack', cols: 8, rows: 5, accepts: 'all', equip: false, rotatable: true },
  armor_head: { id: 'armor_head', label: 'Helmet', cols: 2, rows: 2, accepts: ['armor_head'], equip: false, rotatable: false },
  armor_chest: { id: 'armor_chest', label: 'Body', cols: 2, rows: 2, accepts: ['armor_chest'], equip: false, rotatable: false },
  armor_face: { id: 'armor_face', label: 'Face', cols: 2, rows: 2, accepts: ['armor_face'], equip: false, rotatable: false },
  armor_ears: { id: 'armor_ears', label: 'Ears', cols: 2, rows: 2, accepts: ['armor_ears'], equip: false, rotatable: false },
  // Trousers and boots: the slots are ready; their pieces come later.
  armor_legs: { id: 'armor_legs', label: 'Trousers', cols: 2, rows: 2, accepts: ['armor_legs'], equip: false, rotatable: false },
  armor_feet: { id: 'armor_feet', label: 'Boots', cols: 2, rows: 2, accepts: ['armor_feet'], equip: false, rotatable: false },
  // Off hand: a tool held in the left hand (flashlight).
  offhand: { id: 'offhand', label: 'Off hand', cols: 2, rows: 1, accepts: ['tool'], equip: false, rotatable: false },
  // The worn backpack, and what it adds while worn: a storage grid and a rifle slot. Their items
  // belong to the backpack and leave with it (see InventoryModel.remove / place).
  pack: { id: 'pack', label: 'Backpack', cols: 3, rows: 3, accepts: ['backpack'], equip: false, rotatable: false },
  pack_storage: { id: 'pack_storage', label: 'Backpack storage', cols: 8, rows: 4, accepts: 'all', equip: false, rotatable: true },
  pack_rifle: { id: 'pack_rifle', label: 'Backpack · Rifle', cols: 6, rows: 2, accepts: ['rifle', 'shotgun'], equip: true, rotatable: false },
  // Personal storage at the camp warehouse: three pages, reachable only there.
  stash_1: { id: 'stash_1', label: 'Storage 1', cols: 10, rows: 7, accepts: 'all', equip: false, rotatable: true },
  stash_2: { id: 'stash_2', label: 'Storage 2', cols: 10, rows: 7, accepts: 'all', equip: false, rotatable: true },
  stash_3: { id: 'stash_3', label: 'Storage 3', cols: 10, rows: 7, accepts: 'all', equip: false, rotatable: true },
};

export const STASH_CONTAINERS: ContainerId[] = ['stash_1', 'stash_2', 'stash_3'];
export const isStash = (c: ContainerId): boolean => c === 'stash_1' || c === 'stash_2' || c === 'stash_3';

/** Worn-armour containers, one per slot. */
export const ARMOR_CONTAINERS: Record<ArmorSlot, ContainerId> = { head: 'armor_head', face: 'armor_face', ears: 'armor_ears', chest: 'armor_chest' };
export const EQUIP_ORDER: ContainerId[] = ['heavy', 'primary', 'pack_rifle', 'secondary', 'grenades'];
/** Containers that exist only while a backpack is worn; their items travel inside it. */
export const PACK_CONTAINERS: readonly ContainerId[] = ['pack_storage', 'pack_rifle'];
export const isPackContainer = (c: ContainerId): boolean => c === 'pack_storage' || c === 'pack_rifle';
/** The worn backpack, if any. */
export const wornPack = (items: readonly PlacedItem[]): PlacedItem | undefined => items.find((i) => i.container === 'pack');

export interface PlacedItem {
  uid: number;
  itemId: string;
  container: ContainerId;
  x: number;
  y: number;
  rotated: boolean;
  /** Rounds left in an ammo box, uses of a kit, durability of armour. */
  count?: number;
  /** Rounds in a gun's magazine. */
  mag?: number;
  /** Handed out free by an ammo cache: the merchant won't buy it. */
  issued?: boolean;
  /** Quest item: id of the quest it was found for (it counts for that quest even after a re-accept). */
  quest?: string;
  /** Deployed C4 paired with this remote; distinct from reusable inventory UIDs. */
  chargeId?: number;
  /** Guns: installed attachments (item ids) by slot. */
  attachments?: Attachments;
  /** A backpack that is not worn: the items packed inside it, as placed in its containers. */
  contents?: PlacedItem[];
}

/** What the server persists and sends to its player. */
export interface InventoryData {
  items: PlacedItem[];
  /** uid of the item in hand, or null for empty hands. */
  equipped: number | null;
}

export function footprint(def: ItemDef, rotated: boolean): { w: number; h: number } {
  return rotated ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

export function accepts(c: ContainerDef, def: ItemDef): boolean {
  return c.accepts === 'all' || c.accepts.includes(def.category);
}

/** Can `itemId` sit at (x,y) in `container`, ignoring the item `ignoreUid`? */
export function canPlace(items: readonly PlacedItem[], container: ContainerId, itemId: string, x: number, y: number, rotated: boolean, ignoreUid = -1): boolean {
  const c = CONTAINERS[container];
  const def = ITEMS[itemId];
  if (!c || !def || !accepts(c, def)) return false;
  if (rotated && !c.rotatable && def.w !== def.h) return false;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const { w, h } = footprint(def, rotated);
  if (x < 0 || y < 0 || x + w > c.cols || y + h > c.rows) return false;
  // The backpack's own grids exist only while it is worn; a pack never goes inside a pack.
  if (isPackContainer(container) && (!wornPack(items) || def.category === 'backpack')) return false;
  for (const o of items) {
    if (o.uid === ignoreUid || o.container !== container) continue;
    const od = ITEMS[o.itemId]!;
    const f = footprint(od, o.rotated);
    if (x < o.x + f.w && x + w > o.x && y < o.y + f.h && y + h > o.y) return false;
  }
  return true;
}

/** First free spot for an item, trying the given containers in order. */
export function findSpot(items: readonly PlacedItem[], itemId: string, order: ContainerId[]): Omit<PlacedItem, 'uid' | 'itemId'> | null {
  for (const container of order) {
    const c = CONTAINERS[container];
    for (const rotated of c.rotatable ? [false, true] : [false]) {
      for (let y = 0; y < c.rows; y++) for (let x = 0; x < c.cols; x++) if (canPlace(items, container, itemId, x, y, rotated)) return { container, x, y, rotated };
    }
  }
  return null;
}

/**
 * Auto-sort: repacks one container as tightly as it goes. Biggest items first (like ones side by
 * side), each at the first free cell in reading order, turned whichever way fits earliest.
 * Returns the new placements, or null if they would not all fit (the layout is then kept).
 */
export function packContainer(items: readonly PlacedItem[], container: ContainerId): PlacedItem[] | null {
  const c = CONTAINERS[container];
  const inside = items.filter((i) => i.container === container);
  const others = items.filter((i) => i.container !== container);
  const area = (i: PlacedItem) => { const d = ITEMS[i.itemId]!; return d.w * d.h; };
  const order = [...inside].sort((a, b) => area(b) - area(a) || ITEMS[a.itemId]!.category.localeCompare(ITEMS[b.itemId]!.category) || a.itemId.localeCompare(b.itemId) || a.uid - b.uid);
  const placed: PlacedItem[] = [...others];
  for (const it of order) {
    const def = ITEMS[it.itemId]!;
    // Lying flat (wider than tall) first: rows stay low and the bottom of the bag stays free.
    const turns = c.rotatable ? (def.w >= def.h ? [false, true] : [true, false]) : [false];
    let spot: { x: number; y: number; rotated: boolean } | null = null;
    for (let y = 0; y < c.rows && !spot; y++) for (let x = 0; x < c.cols && !spot; x++)
      for (const rotated of turns) if (canPlace(placed, container, it.itemId, x, y, rotated)) { spot = { x, y, rotated }; break; }
    if (!spot) return null;
    placed.push({ ...it, ...spot });
  }
  return placed.filter((i) => i.container === container);
}

/** Where a newly received item goes: weapons/grenades to a free weapon slot, the rest in the backpack. */
export function addOrder(def: ItemDef): ContainerId[] {
  if (def.category === 'backpack') return ['pack', 'backpack'];
  return def.category === 'ammo' || def.category === 'medical' || def.category.startsWith('armor') || !WEAPON_BY_ITEM[def.id] ? ['backpack', 'pack_storage'] : [...EQUIP_ORDER, 'backpack', 'pack_storage'];
}

/** Hotbar entries: every item in a weapon slot, in slot order (left→right, top→bottom). */
export function hotbar(items: readonly PlacedItem[]): PlacedItem[] {
  return EQUIP_ORDER.flatMap((c) => items.filter((i) => i.container === c).sort((a, b) => a.y - b.y || a.x - b.x));
}

/** A gun's full magazine (undefined for anything that isn't a gun). */
export function magazineOf(itemId: string): number | undefined {
  const spec = weaponSpec(WEAPON_BY_ITEM[itemId] ?? 0);
  return spec?.kind === 'gun' ? spec.magazine : undefined;
}

/**
 * One untrusted item, cleaned: unknown ids are rejected, counts/magazines clamped, spent boxes
 * dropped, attachments checked, and a backpack's packed contents cleaned the same way (they must
 * fit its grids, and a pack never holds another pack). Null when the item is not kept.
 */
export function sanitizeItem(raw: PlacedItem, nested = false): PlacedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const i: PlacedItem = { ...raw };
  const def = ITEMS[i.itemId];
  if (!def || !Number.isInteger(i.uid) || !CONTAINERS[i.container] || !Number.isInteger(i.x) || !Number.isInteger(i.y)) return null;
  if (nested && def.category === 'backpack') return null;
  i.rotated = !!i.rotated;
  if (i.itemId !== 'c4_detonator' || !Number.isSafeInteger(i.chargeId) || i.chargeId! < 1) delete i.chargeId;
  const max = maxCount(def);
  if (max) i.count = Math.max(0, Math.min(max, Number.isFinite(i.count) ? (i.count as number) : max));
  else delete i.count;
  const mag = magazineOf(i.itemId);
  if (mag !== undefined) i.mag = Math.max(0, Math.min(mag, Math.floor(Number.isFinite(i.mag) ? (i.mag as number) : mag)));
  else delete i.mag;
  // Spent boxes / kits are gone; broken armour stays (0 durability).
  if (max && i.count === 0 && !def.armor) return null;
  const attachments = sanitizeAttachments(i.itemId, i.attachments);
  if (attachments) i.attachments = attachments; else delete i.attachments;
  if (def.category === 'backpack' && Array.isArray(raw.contents) && raw.contents.length) {
    // Checked against the pack's own grids, as if it were worn.
    const placed: PlacedItem[] = [{ ...i, container: 'pack', x: 0, y: 0, rotated: false }];
    for (const r of raw.contents) {
      const c = sanitizeItem(r, true);
      // Unique among themselves (they get fresh uids when unpacked; the pack's own may clash).
      if (c && isPackContainer(c.container) && !placed.slice(1).some((p) => p.uid === c.uid) && canPlace(placed, c.container, c.itemId, c.x, c.y, c.rotated)) placed.push(c);
    }
    const contents = placed.slice(1);
    if (contents.length) i.contents = contents; else delete i.contents;
  } else delete i.contents;
  return i;
}

/**
 * One player's inventory with every rule enforced: the server runs this as the authority, so all
 * changes (moves, pick-ups, purchases, ammo, armour wear) go through these methods.
 */
export class InventoryModel {
  items: PlacedItem[] = [];
  equipped: number | null = null;

  constructor(data?: InventoryData | null) {
    if (data) this.load(data);
  }

  /** Accepts persisted/untrusted data, dropping anything invalid or overlapping. */
  load(data: InventoryData): void {
    const valid: PlacedItem[] = [];
    // The worn pack first: its grids must exist before their items are checked.
    const raws = (Array.isArray(data.items) ? data.items : []).slice().sort((a, b) => (a?.container === 'pack' ? 0 : 1) - (b?.container === 'pack' ? 0 : 1));
    const orphans: PlacedItem[] = [];
    for (const raw of raws) {
      const i = sanitizeItem(raw);
      if (!i) continue;
      if (valid.some((v) => v.uid === i.uid)) continue;
      if (!canPlace(valid, i.container, i.itemId, i.x, i.y, i.rotated)) {
        // Items of a pack grid with no pack worn (old saves): kept, moved to the storage below.
        if (isPackContainer(i.container)) orphans.push(i);
        continue;
      }
      valid.push(i);
    }
    for (const i of orphans) {
      const spot = findSpot(valid, i.itemId, ['backpack']);
      if (spot) valid.push({ ...i, ...spot });
    }
    this.items = valid;
    this.equipped = data.equipped ?? null;
    this.fixEquipped();
  }

  toJSON(): InventoryData {
    const copy = (i: PlacedItem): PlacedItem => ({ ...i, ...(i.attachments ? { attachments: { ...i.attachments } } : {}), ...(i.contents ? { contents: i.contents.map(copy) } : {}) });
    return { items: this.items.map(copy), equipped: this.equipped };
  }

  private nextUid(): number {
    let max = 0;
    for (const i of this.items) { max = Math.max(max, i.uid); for (const c of i.contents ?? []) max = Math.max(max, c.uid); }
    return max + 1;
  }

  /** Hands only hold something still in a weapon slot. */
  private fixEquipped(): void {
    const bar = hotbar(this.items);
    if (this.equipped !== null && !bar.some((i) => i.uid === this.equipped)) this.equipped = bar[0]?.uid ?? null;
  }

  get(uid: number): PlacedItem | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  equippedItem(): PlacedItem | undefined {
    return this.equipped === null ? undefined : this.get(this.equipped);
  }

  /** Auto-sort one container (see packContainer); false if nothing could be improved safely. */
  sort(container: ContainerId): boolean {
    const packed = packContainer(this.items, container);
    if (!packed) return false;
    const byUid = new Map(packed.map((i) => [i.uid, i]));
    this.items = this.items.map((i) => byUid.get(i.uid) ?? i);
    return true;
  }

  move(uid: number, container: ContainerId, x: number, y: number, rotated: boolean): boolean {
    const it = this.get(uid);
    if (!it || !canPlace(this.items, container, it.itemId, x, y, rotated, uid)) return false;
    const wasWorn = it.container === 'pack';
    // Taking the pack off packs its grids into it first (they cease to exist without it).
    if (wasWorn && container !== 'pack') this.packInto(it);
    Object.assign(it, { container, x, y, rotated });
    if (!wasWorn && container === 'pack') this.unpack(it);
    this.fixEquipped();
    return true;
  }

  /** Moves everything in the backpack's grids into the pack item (it is being taken off). */
  private packInto(pack: PlacedItem): void {
    const inside = this.items.filter((i) => isPackContainer(i.container));
    if (!inside.length) return;
    pack.contents = [...(pack.contents ?? []), ...inside];
    this.items = this.items.filter((i) => !isPackContainer(i.container));
  }

  /** A worn pack's packed items back into its grids, with fresh uids (others may have taken theirs). */
  private unpack(pack: PlacedItem): void {
    const contents = pack.contents ?? [];
    delete pack.contents;
    for (const c of contents) {
      const item: PlacedItem = { ...c, uid: this.nextUid() };
      if (canPlace(this.items, c.container, c.itemId, c.x, c.y, c.rotated)) this.items.push(item);
      else {
        const spot = findSpot(this.items, c.itemId, ['pack_storage', 'backpack']);
        if (spot) this.items.push({ ...item, ...spot });
        else (pack.contents ??= []).push(c);
      }
    }
  }

  /** Puts packed contents into a backpack just received (picked up, taken from a chest). */
  restoreContents(uid: number, contents: PlacedItem[] | undefined): void {
    const pack = this.get(uid);
    if (!pack || !contents?.length || ITEMS[pack.itemId]?.category !== 'backpack') return;
    const clean = sanitizeItem({ ...pack, contents })?.contents;
    if (!clean?.length) return;
    pack.contents = clean;
    if (pack.container === 'pack') this.unpack(pack);
    this.fixEquipped();
  }

  equip(uid: number | null): boolean {
    if (uid !== null && !hotbar(this.items).some((i) => i.uid === uid)) return false;
    this.equipped = uid;
    return true;
  }

  hasRoomFor(itemId: string): boolean {
    const def = ITEMS[itemId];
    return !!def && findSpot(this.items, itemId, addOrder(def)) !== null;
  }

  /** Adds a fresh item (full box / full magazine unless `count` given); null when there is no room. */
  add(itemId: string, count?: number, issued = false): PlacedItem | null {
    const def = ITEMS[itemId];
    if (!def) return null;
    const spot = findSpot(this.items, itemId, addOrder(def));
    if (!spot) return null;
    const item: PlacedItem = { uid: this.nextUid(), itemId, ...spot };
    const max = maxCount(def);
    if (max) item.count = Math.max(0, Math.min(max, count ?? max));
    const mag = magazineOf(itemId);
    if (mag !== undefined) item.mag = mag;
    if (issued) item.issued = true;
    this.items.push(item);
    if (this.equipped === null && hotbar(this.items).some((i) => i.uid === item.uid)) this.equipped = item.uid;
    return item;
  }

  /**
   * Installs an attachment item onto a gun. The attachment leaves the inventory; whatever occupied
   * the slot comes back as an item in the accessory's place, so nothing is duplicated or lost.
   */
  attach(gunUid: number, attachmentUid: number): boolean {
    const gun = this.get(gunUid), part = this.get(attachmentUid);
    if (!gun || !part || gun === part) return false;
    const slot = compatibleSlot(gun.itemId, part.itemId);
    if (!slot) return false;
    const previous = gun.attachments?.[slot];
    this.items = this.items.filter((i) => i !== part);
    if (previous) {
      // The old attachment takes the freed cells if it fits there, else any free spot.
      const back: PlacedItem = { uid: part.uid, itemId: previous, container: part.container, x: part.x, y: part.y, rotated: part.rotated };
      if (canPlace(this.items, back.container, previous, back.x, back.y, back.rotated)) this.items.push(back);
      else {
        const spot = findSpot(this.items, previous, ['backpack']);
        if (!spot) { this.items.push(part); return false; }
        this.items.push({ ...back, ...spot });
      }
    }
    gun.attachments = { ...gun.attachments, [slot]: part.itemId };
    this.fixEquipped();
    return true;
  }

  /** Takes an attachment off a gun back into the backpack (false when there is no room). */
  detach(gunUid: number, slot: AttachmentSlot): boolean {
    const gun = this.get(gunUid), id = gun?.attachments?.[slot];
    if (!gun || !id) return false;
    const spot = findSpot(this.items, id, ['backpack']);
    if (!spot) return false;
    this.items.push({ uid: this.nextUid(), itemId: id, ...spot });
    const rest = { ...gun.attachments };
    delete rest[slot];
    if (Object.keys(rest).length) gun.attachments = rest; else delete gun.attachments;
    return true;
  }

  /** Takes an item out; a worn pack leaves with everything in its grids packed inside. */
  remove(uid: number): PlacedItem | null {
    const it = this.get(uid);
    if (!it) return null;
    if (it.container === 'pack') this.packInto(it);
    this.items = this.items.filter((i) => i !== it);
    this.fixEquipped();
    return it;
  }

  /** An item on the player (null for unknown uids and items left in the camp storage). */
  carriedItem(uid: number): PlacedItem | null {
    const it = this.get(uid);
    return it && !isStash(it.container) ? it : null;
  }

  /** A flashlight held in the off hand. */
  hasFlashlight(): boolean {
    return this.items.some((i) => i.container === 'offhand' && i.itemId === 'flashlight');
  }

  /** Items on the player (not left in the camp storage). */
  private get carried(): PlacedItem[] {
    return this.items.filter((i) => !isStash(i.container));
  }

  /** How many of an item are carried (counting uses/rounds for counted items). */
  countOf(itemId: string): number {
    return this.carried.filter((i) => i.itemId === itemId && !i.issued).length;
  }

  /** Units of a resource carried: stack counts for stackable items, whole items otherwise. */
  unitsOf(itemId: string): number {
    const stack = ITEMS[itemId]?.stack;
    return this.carried.filter((i) => i.itemId === itemId && !i.issued).reduce((n, i) => n + (stack ? i.count ?? stack : 1), 0);
  }

  /** Adds `n` units: tops up carried stacks first, then fills new ones. Returns how many fitted. */
  addUnits(itemId: string, n: number): number {
    const def = ITEMS[itemId];
    if (!def || n <= 0) return 0;
    if (!def.stack) {
      let added = 0;
      while (added < n && this.add(itemId)) added++;
      return added;
    }
    let left = n;
    for (const it of this.carried) {
      if (left <= 0) break;
      if (it.itemId !== itemId || it.issued) continue;
      const room = def.stack - (it.count ?? def.stack);
      const take = Math.min(room, left);
      if (take > 0) { it.count = (it.count ?? def.stack) + take; left -= take; }
    }
    while (left > 0) {
      const it = this.add(itemId, Math.min(def.stack, left));
      if (!it) break;
      left -= it.count ?? 0;
    }
    return n - left;
  }

  /** Takes `n` units (smallest stacks first); false and nothing taken when there are not enough. */
  takeUnits(itemId: string, n: number): boolean {
    if (n <= 0) return true;
    if (this.unitsOf(itemId) < n) return false;
    const stack = ITEMS[itemId]?.stack;
    if (!stack) return this.takeItems(itemId, n);
    let left = n;
    for (const it of this.carried.filter((i) => i.itemId === itemId && !i.issued).sort((a, b) => (a.count ?? stack) - (b.count ?? stack))) {
      if (left <= 0) break;
      const have = it.count ?? stack;
      if (have <= left) { this.remove(it.uid); left -= have; } else { it.count = have - left; left = 0; }
    }
    return true;
  }

  /** Puts an item in the camp storage (first free page); null when all three pages are full. */
  addToStash(itemId: string, count?: number): PlacedItem | null {
    const def = ITEMS[itemId];
    if (!def) return null;
    const spot = findSpot(this.items, itemId, STASH_CONTAINERS);
    if (!spot) return null;
    const item: PlacedItem = { uid: this.nextUid(), itemId, ...spot };
    const max = maxCount(def);
    if (max) item.count = Math.max(0, Math.min(max, count ?? max));
    const mag = magazineOf(itemId);
    if (mag !== undefined) item.mag = mag;
    this.items.push(item);
    return item;
  }

  /** Quest items of a kind found for one quest. */
  countTagged(itemId: string, quest: string): number {
    return this.carried.filter((i) => i.itemId === itemId && i.quest === quest).length;
  }

  /** Removes `n` quest items found for `quest`; false (and nothing removed) if not enough. */
  takeTagged(itemId: string, quest: string, n: number): boolean {
    const list = this.carried.filter((i) => i.itemId === itemId && i.quest === quest);
    if (list.length < n) return false;
    for (const it of list.slice(0, n)) this.remove(it.uid);
    return true;
  }

  /** Removes `n` whole items of a kind (ordinary ones before quest items); false if not enough. */
  takeItems(itemId: string, n: number): boolean {
    // Free ammo-cache kit never pays for anything (quests, NPC trades, planting, cooking).
    const list = this.carried.filter((i) => i.itemId === itemId && !i.issued).sort((a, b) => Number(!!a.quest) - Number(!!b.quest));
    if (list.length < n) return false;
    for (const it of list.slice(0, n)) this.remove(it.uid);
    return true;
  }

  /** Uses the item in hand up (a thrown grenade); another of the same kind takes its place. */
  consumeEquipped(): string | null {
    const cur = this.equippedItem();
    if (!cur) return null;
    this.remove(cur.uid);
    const next = hotbar(this.items).find((i) => i.itemId === cur.itemId);
    this.equipped = next?.uid ?? null;
    return cur.itemId;
  }

  /** One charge of a multi-use item (first aid kit); the empty item is discarded. */
  useCharge(uid: number): boolean {
    const it = this.get(uid);
    if (!it) return false;
    const left = (it.count ?? maxCount(ITEMS[it.itemId]!) ?? 1) - 1;
    if (left > 0) it.count = left;
    else this.remove(uid);
    return true;
  }

  /** Rounds carried in ammo boxes for a gun (item id). */
  ammoFor(gunItemId: string): number {
    let n = 0;
    for (const i of this.carried) if (ITEMS[i.itemId]?.ammo?.guns.includes(gunItemId)) n += i.count ?? 0;
    return n;
  }

  /** Draws up to `want` rounds from the gun's ammo boxes (emptiest first; empty boxes vanish). */
  takeAmmo(gunItemId: string, want: number): number {
    const boxes = this.carried
      .filter((i) => ITEMS[i.itemId]?.ammo?.guns.includes(gunItemId) && (i.count ?? 0) > 0)
      .sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
    let taken = 0;
    for (const b of boxes) {
      if (taken >= want) break;
      const n = Math.min(want - taken, b.count ?? 0);
      taken += n;
      b.count = (b.count ?? 0) - n;
      if (b.count <= 0) this.remove(b.uid);
    }
    return taken;
  }

  /** Armour worn right now (wire ids; broken pieces count as none). */
  worn(): ArmorLoadout {
    const out: ArmorLoadout = { ...NO_ARMOR };
    for (const slot of ARMOR_SLOTS) {
      const it = this.items.find((i) => i.container === ARMOR_CONTAINERS[slot]);
      const a = it && ITEMS[it.itemId]?.armor;
      if (a && (it.count ?? a.durability) > 0) out[slot] = a.id;
    }
    return out;
  }

  /** Worn pieces soak up `absorbed` damage, shared by their protection; returns slots that broke. */
  wearArmor(absorbed: number): ArmorSlot[] {
    const worn = this.items.filter((i) => ARMOR_SLOTS.some((s) => ARMOR_CONTAINERS[s] === i.container) && (i.count ?? 1) > 0);
    const prot = (i: PlacedItem) => ARMOR_BY_ID.get(ITEMS[i.itemId]!.armor!.id)?.protection ?? 0;
    const total = worn.reduce((a, i) => a + prot(i), 0);
    if (!worn.length || total <= 0) return [];
    const broke: ArmorSlot[] = [];
    for (const i of worn) {
      const a = ITEMS[i.itemId]!.armor!;
      const n = Math.max(0, (i.count ?? a.durability) - absorbed * (prot(i) / total));
      i.count = Math.round(n * 10) / 10;
      if (n <= 0) broke.push(a.slot);
    }
    return broke;
  }

  /** The main-slot weapon (heavy, then primary) not in hand: carried on the back. */
  /** Everything carried on the body but not in hand, for the character model (see CarriedGear). */
  gear(): CarriedGear { return carriedGear(this.items, this.equipped); }

  backItem(): PlacedItem | undefined {
    for (const c of ['heavy', 'primary'] as const) {
      const it = this.items.filter((i) => i.container === c && i.uid !== this.equipped).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (it) return it;
    }
    return undefined;
  }
}

/**
 * What hangs on the body (not in hand): long guns slung on the back (on the backpack's sides and
 * across its top when one is worn), the pistol/SMG on the left belt hook, a grenade or C4 on the
 * right belt hook, and the worn backpack.
 */
export interface CarriedGear { back: string[]; holster: string | null; belt: string | null; pack: string | null }

export function carriedGear(items: readonly PlacedItem[], equipped: number | null): CarriedGear {
  const free = (c: ContainerId) => items.filter((i) => i.container === c && i.uid !== equipped).sort((a, b) => a.y - b.y || a.x - b.x);
  const back = (['heavy', 'primary', 'pack_rifle'] as const).flatMap(free).slice(0, 3).map((i) => i.itemId);
  return { back, holster: free('secondary')[0]?.itemId ?? null, belt: free('grenades')[0]?.itemId ?? null, pack: wornPack(items)?.itemId ?? null };
}

/** Gear on the wire: second/third back gun, holster and belt as weapon ids in one u32. */
export function packGear(g: CarriedGear, weaponOf: (itemId: string) => number): { back: number; gear: number; pack: number } {
  const id = (itemId: string | null | undefined) => (itemId ? weaponOf(itemId) & 0xff : 0);
  return { back: id(g.back[0]), gear: (id(g.back[1]) | id(g.back[2]) << 8 | id(g.holster) << 16 | id(g.belt) << 24) >>> 0, pack: g.pack ? 1 : 0 };
}

export function unpackGear(back: number, gear: number, pack: number, itemOf: (weapon: number) => string | undefined): CarriedGear {
  const item = (w: number) => (w ? itemOf(w) ?? null : null);
  return { back: [back, gear & 0xff, gear >>> 8 & 0xff].map(item).filter((i): i is string => !!i), holster: item(gear >>> 16 & 0xff), belt: item(gear >>> 24 & 0xff), pack: pack ? 'military_backpack' : null };
}

/** The kit a brand-new survivor starts with. */
export function defaultLoadout(): InventoryData {
  const m = new InventoryModel();
  const put = (itemId: string, container: ContainerId, x: number, y: number) => {
    const def = ITEMS[itemId]!;
    const item: PlacedItem = { uid: m.items.length + 1, itemId, container, x, y, rotated: false, issued: true };
    const max = maxCount(def);
    if (max) item.count = max;
    const mag = magazineOf(itemId);
    if (mag !== undefined) item.mag = mag;
    m.items.push(item);
  };
  put('gl18', 'secondary', 0, 0);
  put('grenade', 'grenades', 0, 0);
  put('grenade', 'grenades', 1, 0);
  for (let i = 0; i < 5; i++) put('potato_cooked', 'backpack', 3 + i, 0);
  put('potato', 'backpack', 3, 1);
  put('medkit', 'backpack', 0, 0);
  for (let i = 0; i < 5; i++) put('ammo_9mm', 'backpack', i, 2);
  return { items: m.items, equipped: 1 };
}
