import { CACHE_DRAWS_PER_DAY, type ChestStateMessage } from '@zion/shared';
import { markPending } from '../pending';
import {
  ARMOR_CONTAINERS,
  ARMOR_SLOTS,
  EQUIP_ORDER,
  ITEMS,
  NO_ARMOR,
  addOrder,
  canPlace,
  findSpot,
  hotbar,
  type ArmorLoadout,
  type ContainerId,
  type InvMessage,
  type PlacedItem,
  type Stance,
} from '@zion/shared';

// The grid rules and catalog live in @zion/shared (the server enforces the same ones).
export {
  ARMOR_CONTAINERS,
  CONTAINERS,
  EQUIP_ORDER,
  accepts,
  canPlace,
  findSpot,
  footprint,
  hotbar,
  type ContainerDef,
  type ContainerId,
  type PlacedItem,
} from '@zion/shared';

export interface HeldItem {
  uid: number;
  itemId: string;
  rotated: boolean;
  count?: number;
  issued?: boolean;
  /** Where it was picked up from, so Esc / closing can put it back. */
  from: { container: ContainerId; x: number; y: number; rotated: boolean };
}

export interface InventoryState {
  open: boolean;
  chest: ChestStateMessage | null;
  items: PlacedItem[];
  held: HeldItem | null;
  /** uid of the item in hand (hotbar selection), or null for empty hands. */
  equipped: number | null;
  /** Opened at an ammo cache station / trader: which side panel is shown. */
  station: 'field' | 'camp' | 'shop' | 'nurse' | 'stash' | 'chest' | null;
  /** Ammo-cache draws left this world day (server-reported). */
  cacheLeft: number;
}

/**
 * The player's inventory as the client sees it. The **server owns it**: every change is sent as a
 * request and the server answers with the true state (`applyServer`). Moves are shown immediately
 * (optimistic, using the same shared grid rules) and corrected if the server disagrees.
 */
export class InventoryStore {
  private state: InventoryState = { chest: null, open: false, items: [], held: null, equipped: null, station: null, cacheLeft: CACHE_DRAWS_PER_DAY };
  private chestId: string | null = null;
  private readonly listeners = new Set<() => void>();
  /** Sends an inventory request to the server (wired by the engine). */
  send: ((msg: InvMessage) => void) | null = null;

  get = (): InventoryState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<InventoryState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** The server's state. While an item is being dragged it stays "in hand" in the UI. */
  applyServer(items: PlacedItem[], equipped: number | null, cacheLeft?: number): void {
    if (cacheLeft !== undefined && cacheLeft !== this.state.cacheLeft) this.set({ cacheLeft });
    const held = this.state.held;
    if (held && !items.some((i) => i.uid === held.uid)) {
      this.set({ items, equipped, held: null });
      return;
    }
    this.set({ items: held ? items.filter((i) => i.uid !== held.uid) : items, equipped });
  }

  openChest(id: string): void {
    this.returnHeld();
    this.chestId = id;
    this.set({ open: true, station: 'chest', chest: null });
    this.send?.({ t: 'inv', op: 'chestOpen', id });
  }

  applyChest(message: ChestStateMessage): void {
    if (message.id !== this.chestId) return;
    if (message.closed) { this.setOpen(false); return; }
    this.set({ chest: message });
  }

  chestAction(op: 'chestSearch' | 'chestTake' | 'chestPut', uid = 0): void {
    const chest = this.state.chest;
    if (!chest || chest.busy || chest.searchRemainingMs > 0) return;
    if (op === 'chestSearch') this.send?.({ t: 'inv', op, id: chest.id });
    else this.send?.({ t: 'inv', op, id: chest.id, uid, revision: chest.revision });
  }

  setOpen(open: boolean, station: 'field' | 'camp' | 'shop' | 'nurse' | 'stash' | 'chest' | null = null): void {
    if (!open) this.returnHeld();
    if ((!open || station !== 'chest') && this.chestId) { this.chestId = null; this.send?.({ t: 'inv', op: 'chestClose' }); this.set({ chest: null }); }
    this.set({ open, station: open ? station : null });
  }

  toggle(): void {
    this.setOpen(!this.state.open);
  }

  /** Throws the held item out of the inventory onto the ground (server drops it there). */
  throwHeld(): void {
    const h = this.state.held;
    if (!h) return;
    this.set({ held: null });
    this.send?.({ t: 'inv', op: 'drop', uid: h.uid });
  }

  /** Picks up a ground item by id (server checks reach and room). */
  pickUpGround(id: number): void {
    this.send?.({ t: 'inv', op: 'pickup', id });
  }

  /** Would `itemId` fit somewhere right now? (a hint; the server decides) */
  hasRoomFor(itemId: string): boolean {
    const def = ITEMS[itemId];
    return !!def && findSpot(this.state.items, itemId, addOrder(def)) !== null;
  }

  /** Armour worn right now (wire ids; broken pieces count as none). */
  wornArmor(): ArmorLoadout {
    const out: ArmorLoadout = { ...NO_ARMOR };
    for (const slot of ARMOR_SLOTS) {
      const it = this.state.items.find((i) => i.container === ARMOR_CONTAINERS[slot]);
      const a = it && ITEMS[it.itemId]?.armor;
      if (a && (it.count ?? a.durability) > 0) out[slot] = a.id;
    }
    return out;
  }

  /** Shop / station hooks, wired by the engine. */
  onBuy: ((itemId: string) => void) | null = null;
  onSell: ((uid: number) => void) | null = null;
  /** Use a first aid kit (H / right-click); `uid` picks a specific one. Returns whether it started. */
  onUseMedkit: ((uid?: number) => boolean) | null = null;
  /** Right-click food: eat it (returns false when it isn't edible). */
  onUseCoal: ((uid: number) => boolean) | null = null;
  onEat: ((uid: number) => boolean) | null = null;
  /** Testing aid: + 1000 ZCoin. */
  onDevCoins: (() => void) | null = null;
  /** Pay the field medic for a full heal. */
  onNurseHeal: (() => void) | null = null;
  /** The 3D character viewer shown in the equipment panel (set by the engine). */
  preview: { mount(host: HTMLElement): () => void } | null = null;

  /** Takes one item from the ammo cache the panel was opened at (server checks reach & stock). */
  takeFromCache(itemId: string): boolean {
    if (!this.hasRoomFor(itemId)) return false;
    if (this.state.cacheLeft <= 0) return true;
    markPending(`cache:${itemId}`);
    this.send?.({ t: 'inv', op: 'cache', item: itemId });
    return true;
  }

  /** Rounds carried in ammo boxes for a gun (item id). */
  ammoFor(gunItemId: string): number {
    let n = 0;
    for (const i of this.state.items) if (ITEMS[i.itemId]?.ammo?.guns.includes(gunItemId)) n += i.count ?? 0;
    return n;
  }

  /** Pick up the item under a cell (Minecraft style: click to grab, click to drop). Local only. */
  pickUp(uid: number): void {
    if (this.state.held) return;
    const it = this.state.items.find((i) => i.uid === uid);
    if (!it) return;
    this.set({
      items: this.state.items.filter((i) => i.uid !== uid),
      held: { uid, itemId: it.itemId, rotated: it.rotated, count: it.count, issued: it.issued, from: { container: it.container, x: it.x, y: it.y, rotated: it.rotated } },
    });
  }

  /** Drop the held item with its top-left cell at (x,y). Returns false if it doesn't fit. */
  drop(container: ContainerId, x: number, y: number): boolean {
    const h = this.state.held;
    if (!h || !canPlace(this.state.items, container, h.itemId, x, y, h.rotated)) return false;
    const placed = this.placedFromHeld(h, container, x, y, h.rotated);
    this.set({ items: [...this.state.items, placed], held: null });
    this.send?.({ t: 'inv', op: 'move', uid: h.uid, c: container, x, y, r: h.rotated });
    return true;
  }

  private placedFromHeld(h: HeldItem, container: ContainerId, x: number, y: number, rotated: boolean): PlacedItem {
    return { uid: h.uid, itemId: h.itemId, container, x, y, rotated, count: h.count, issued: h.issued };
  }

  rotateHeld(): void {
    const h = this.state.held;
    if (h) this.set({ held: { ...h, rotated: !h.rotated } });
  }

  /** Rotate a melee weapon in place only when the new footprint fits. */
  rotateItem(uid: number): boolean {
    if (this.state.held) return false;
    const it = this.state.items.find(item => item.uid === uid);
    if (!it || ITEMS[it.itemId]?.category !== 'melee') return false;
    const rotated = !it.rotated;
    if (!canPlace(this.state.items, it.container, it.itemId, it.x, it.y, rotated, uid)) return false;
    this.set({ items: this.state.items.map(item => item.uid === uid ? { ...item, rotated } : item) });
    this.send?.({ t: 'inv', op: 'move', uid, c: it.container, x: it.x, y: it.y, r: rotated });
    return true;
  }

  /** Shift-click: send an item to the first container (other than its own) that takes it. */
  quickMove(uid: number): void {
    const it = this.state.items.find((i) => i.uid === uid);
    if (!it) return;
    const rest = this.state.items.filter((i) => i.uid !== uid);
    const armor = ITEMS[it.itemId]?.armor;
    const order: ContainerId[] = it.container !== 'backpack' ? ['backpack'] : armor ? [ARMOR_CONTAINERS[armor.slot]] : [...EQUIP_ORDER];
    const spot = findSpot(rest, it.itemId, order);
    if (!spot) return;
    this.set({ items: [...rest, { ...it, ...spot }] });
    this.send?.({ t: 'inv', op: 'move', uid, c: spot.container, x: spot.x, y: spot.y, r: spot.rotated });
  }

  /** Puts the dragged item back where it was (it never left there on the server). */
  returnHeld(): void {
    const h = this.state.held;
    if (!h) return;
    const { container, x, y, rotated } = h.from;
    this.set({ items: [...this.state.items, this.placedFromHeld(h, container, x, y, rotated)], held: null });
  }

  /** Hotbar key (0-based). Pressing the active slot again holsters. */
  selectSlot(index: number): void {
    const it = hotbar(this.state.items)[index];
    if (!it) return;
    this.equip(this.state.equipped === it.uid ? null : it.uid);
  }

  cycle(dir: number): void {
    const bar = hotbar(this.state.items);
    if (!bar.length) return;
    const i = bar.findIndex((b) => b.uid === this.state.equipped);
    this.equip(bar[(i + dir + bar.length) % bar.length]!.uid);
  }

  private equip(uid: number | null): void {
    this.set({ equipped: uid });
    this.send?.({ t: 'inv', op: 'equip', uid });
  }

  /** The item in hand. */
  equippedItem(): PlacedItem | undefined {
    return this.state.items.find((i) => i.uid === this.state.equipped);
  }

  /** Catalog id of the item in hand, or null. */
  equippedItemId(): string | null {
    return this.equippedItem()?.itemId ?? null;
  }

  /** Stance for the character model, from the item in hand. */
  stance(): Stance {
    const it = this.equippedItem();
    return it ? ITEMS[it.itemId]!.stance : 'unarmed';
  }
}
