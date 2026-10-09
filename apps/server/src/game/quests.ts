import { InventoryModel, type GameContent, type QuestDef } from '@zion/shared';

export interface QuestRun {
  status: 'active' | 'ready' | 'claimed' | 'cancelled';
  stage: number;
  progress: number;
  cycle: number;
  /** Retrieval tokens are virtual, never tradable inventory items. */
  cargo: Record<string, number>;
  location?: { x: number; z: number; radius: number };
  /** Retrieve stage: where this player's quest items still lie (placed once, persisted). */
  drops?: Array<{ x: number; z: number }>;
}
export type QuestJournal = Record<string, QuestRun>;
export interface QuestOwner { journal: QuestJournal; inv: InventoryModel; coins: number }
export type QuestEvent = { type: 'kill'; target: 'zombie' } | { type: 'visit'; x: number; z: number } | { type: 'plant' | 'harvest' | 'collect' | 'cook' | 'interact'; target: string; quantity: number };

/** Pure server domain engine. Callers authorize proximity and serialize durable mutations. */
export class QuestEngine {
  constructor(readonly content: GameContent) {}

  cycle(now: number): number {
    return Math.floor((now - this.content.dailyResetHourUtc * 3_600_000) / 86_400_000);
  }

  /** The retrieve step a delivery belongs to (same item, just before it), if any. */
  private sourceOf(q: QuestDef, stage: number): Extract<QuestDef['objectives'][number], { type: 'retrieve' }> | null {
    const o = q.objectives[stage];
    const prev = q.objectives[stage - 1];
    return o?.type === 'deliver' && prev?.type === 'retrieve' && prev.item === o.item ? prev : null;
  }

  /**
   * Quest items live in the inventory: a retrieve step counts the items carried for it (so a
   * cancelled and re-accepted quest keeps them), and a delivery whose items were lost goes back
   * to the retrieve step so new ones are placed.
   */
  private syncItems(owner: QuestOwner): void {
    for (const q of this.content.quests) {
      const r = owner.journal[q.id];
      if (!r || r.status !== 'active') continue;
      const src = this.sourceOf(q, r.stage);
      if (src && owner.inv.countTagged(src.item, q.id) < src.count) {
        r.stage--;
        r.progress = 0;
        delete r.drops;
      }
      const o = q.objectives[r.stage];
      if (o?.type !== 'retrieve') continue;
      r.progress = Math.min(o.count, owner.inv.countTagged(o.item, q.id));
      if (r.progress >= o.count) this.advance(q, r);
    }
  }

  reset(owner: QuestOwner, now: number): void {
    this.syncItems(owner);
    for (const [id, run] of Object.entries(owner.journal)) {
      const def = this.content.quests.find((q) => q.id === id);
      if (def?.kind === 'daily' && run.cycle !== this.cycle(now)) { delete owner.journal[id]; continue; }
      if ((!def || !def.enabled || (def.availableUntil !== undefined && now >= def.availableUntil)) && run.status !== 'claimed') { run.status = 'cancelled'; run.cargo = {}; delete run.location; }
    }
  }

  accept(owner: QuestOwner, id: string, now: number): boolean {
    this.reset(owner, now);
    const q = this.content.quests.find((q) => q.id === id && q.enabled);
    if (!q || (q.availableFrom !== undefined && now < q.availableFrom) || (q.availableUntil !== undefined && now >= q.availableUntil) || (owner.journal[id] && owner.journal[id]?.status !== 'cancelled')) return false;
    if (q.prereq.some((p) => owner.journal[p]?.status !== 'claimed')) return false;
    owner.journal[id] = { status: 'active', stage: 0, progress: 0, cycle: this.cycle(now), cargo: {} };
    this.syncItems(owner);
    return true;
  }

  cancel(owner: QuestOwner, id: string): boolean {
    const r = owner.journal[id];
    if (this.content.quests.find((q) => q.id === id)?.allowCancel === false) return false;
    if (!r || (r.status !== 'active' && r.status !== 'ready')) return false;
    r.status = 'cancelled';
    r.cargo = {};
    delete r.location;
    delete r.drops;
    return true;
  }

  private advance(q: QuestDef, r: QuestRun): void {
    r.stage++;
    r.progress = 0;
    delete r.location;
    delete r.drops;
    if (r.stage >= q.objectives.length) r.status = 'ready';
  }

  event(owner: QuestOwner, event: QuestEvent, now: number): boolean {
    this.reset(owner, now);
    let changed = false;
    for (const q of this.content.quests) {
      const r = owner.journal[q.id];
      if (!r || r.status !== 'active') continue;
      const o = q.objectives[r.stage];
      if (o && ['plant', 'harvest', 'collect', 'cook', 'interact'].includes(o.type) && o.type === event.type && 'target' in o && 'target' in event && o.target === event.target && 'quantity' in event && event.quantity > 0 && Number.isSafeInteger(event.quantity)) {
        r.progress += event.quantity;
        if (r.progress >= o.count) this.advance(q, r);
        changed = true;
      } else if (o?.type === 'kill' && event.type === 'kill' && o.target === event.target) {
        r.progress++;
        if (r.progress >= o.count) this.advance(q, r);
        changed = true;
      } else if (o?.type === 'visit' && event.type === 'visit' && r.location && Math.hypot(event.x - r.location.x, event.z - r.location.z) <= r.location.radius) {
        this.advance(q, r);
        changed = true;
      }
    }
    return changed;
  }

  /** How many quest items still have to be placed in the world for this player's retrieve step. */
  missingDrops(owner: QuestOwner, id: string): number {
    const q = this.content.quests.find((d) => d.id === id);
    const r = owner.journal[id];
    const o = q?.objectives[r?.stage ?? -1];
    if (!q || !r || r.status !== 'active' || o?.type !== 'retrieve') return 0;
    return Math.max(0, o.count - owner.inv.countTagged(o.item, id));
  }

  /** Picks up placed quest item `index`: a real inventory item tagged with the quest. */
  retrieve(owner: QuestOwner, id: string, index: number, x: number, z: number, now: number): boolean {
    this.reset(owner, now);
    const q = this.content.quests.find((q) => q.id === id);
    const r = owner.journal[id];
    const o = q?.objectives[r?.stage ?? -1];
    const drop = r?.drops?.[index];
    if (!q || !r || r.status !== 'active' || o?.type !== 'retrieve' || !drop || Math.hypot(x - drop.x, z - drop.z) > 3) return false;
    const item = owner.inv.add(o.item);
    if (!item) return false;
    item.quest = q.id;
    r.drops!.splice(index, 1);
    this.syncItems(owner);
    return true;
  }

  /** Delivery and rewards run on a copy; lack of backpack space changes nothing. */
  turnIn(owner: QuestOwner, id: string, now: number): boolean {
    this.reset(owner, now);
    const q = this.content.quests.find((q) => q.id === id && q.enabled);
    const original = owner.journal[id];
    if (!q || !original || !['active', 'ready'].includes(original.status)) return false;
    const r: QuestRun = structuredClone(original);
    const inv = new InventoryModel(owner.inv.toJSON());
    while (r.status === 'active') {
      const o = q.objectives[r.stage];
      if (o?.type !== 'deliver') break;
      // Items found for this quest must be handed in themselves; plain deliveries take any.
      if (this.sourceOf(q, r.stage) ? !inv.takeTagged(o.item, q.id, o.count) : !inv.takeItems(o.item, o.count)) break;
      this.advance(q, r);
    }
    if (r.status === 'ready') {
      // Rewards that don't fit in the bag go to the player's camp storage.
      for (const reward of q.rewards.items) for (let i = 0; i < reward.count; i++) if (!inv.add(reward.item) && !inv.addToStash(reward.item)) return false;
      if (!Number.isSafeInteger(owner.coins + q.rewards.coins) || owner.coins + q.rewards.coins > 2_147_483_647) return false;
      owner.coins += q.rewards.coins;
      r.status = 'claimed';
      r.cargo = {};
    }
    if (r.stage === original.stage && r.status === original.status) return false;
    owner.inv.load(inv.toJSON());
    owner.journal[id] = r;
    return true;
  }
}
