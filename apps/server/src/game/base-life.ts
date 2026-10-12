import { InventoryModel, type BaseLifeConfig, type CookingBatch, type TutorialProgress } from '@zion/shared';
export interface LifePlayer {
  stamina: number;
  capacity: number;
  quotas: Record<string, { start: number; used: number; blockedUntil: number }>;
  /** Fed until then: capacity does not drain. */
  fullUntil?: number;
  tutorial?: TutorialProgress;
}
export interface PlotState { crop: string; stage: number }
export interface AnimalRecord { health: number; x: number; y: number; z: number; loot: number; diedAt?: number; cooked?: boolean }
export interface CoalPile { id: string; x: number; y: number; z: number; expiresAt: number }
export interface LifeWorld { coals?: Record<string, CoalPile>; animals?: Record<string, AnimalRecord>; plots: Record<string, PlotState>; nextGrowth: number }
export interface LifeOwner { inv: InventoryModel; coins: number; life: LifePlayer }
export interface TimedAction { kind: 'plant' | 'cook' | 'harvest'; target: string; choice: string; x: number; z: number; end: number; ms: number; cookBatch?: CookingBatch }
export class BaseLife {
  constructor(readonly config: BaseLifeConfig) {}
  initial(): LifePlayer { return { stamina: this.config.stamina.maximum, capacity: this.config.stamina.maximum, quotas: {} }; }
  expireCoals(world: LifeWorld, now: number): boolean {
    let changed = false;
    for (const [id, pile] of Object.entries(world.coals ?? {})) if (pile.expiresAt <= now) { delete world.coals![id]; changed = true; }
    return changed;
  }
  spend(life: LifePlayer, amount: number): boolean {
    if (life.stamina < amount) return false;
    life.stamina -= amount;
    if (!(life.fullUntil && Date.now() < life.fullUntil)) life.capacity = Math.max(this.config.stamina.minimumCapacity, life.capacity - amount * this.config.stamina.capacityDecay);
    life.stamina = Math.min(life.stamina, life.capacity);
    return true;
  }
  rest(life: LifePlayer, dt: number): void { life.stamina = Math.min(life.capacity, life.stamina + dt * this.config.stamina.regeneration); }
  plant(world: LifeWorld, owner: LifeOwner, plot: string, cropId: string): boolean {
    const crop = this.config.crops.find((c) => c.id === cropId);
    if (!crop || !this.config.plots.some((p) => p.id === plot) || world.plots[plot] || !owner.inv.takeItems(crop.item, 1)) return false;
    world.plots[plot] = { crop: cropId, stage: 0 };
    return true;
  }
  harvest(world: LifeWorld, owner: LifeOwner, plot: string): { item: string; quantity: number } | null {
    const p = world.plots[plot];
    const crop = this.config.crops.find((c) => c.id === p?.crop);
    if (!crop || !p || p.stage < crop.stages.length - 1) return null;
    const inv = new InventoryModel(owner.inv.toJSON());
    for (let i = 0; i < crop.yield; i++) if (!inv.add(crop.yieldItem)) return null;
    owner.inv.load(inv.toJSON());
    delete world.plots[plot];
    return { item: crop.yieldItem, quantity: crop.yield };
  }
  growth(world: LifeWorld, now: number, random = Math.random): boolean {
    if (now < world.nextGrowth) return false;
    world.nextGrowth = now + this.config.growthTickMs;
    for (const p of Object.values(world.plots)) {
      const crop = this.config.crops.find((c) => c.id === p.crop);
      if (crop && p.stage < crop.stages.length - 1 && random() < crop.probability) p.stage++;
    }
    return true;
  }
  cook(owner: LifeOwner, batch: CookingBatch): Array<{ item: string; quantity: number }> | null {
    if (!batch.quantity || !batch.entries.length) return null;
    const inv = new InventoryModel(owner.inv.toJSON());
    // Validate the exact ingredients captured at the start, before changing any real inventory.
    for (const entry of batch.entries) {
      const recipe = this.config.recipes.find((r) => r.id === entry.recipe);
      if (!recipe || recipe.input !== entry.input || recipe.output !== entry.output) return null;
      for (const uid of entry.uids) {
        const item = inv.carriedItem(uid);
        if (!item || item.itemId !== entry.input || item.issued) return null;
        inv.remove(uid);
      }
    }
    const result: Array<{ item: string; quantity: number }> = [];
    for (const entry of batch.entries) {
      for (const _uid of entry.uids) if (!inv.add(entry.output)) return null;
      result.push({ item: entry.output, quantity: entry.uids.length });
    }
    owner.inv.load(inv.toJSON());
    return result;
  }
  trade(owner: LifeOwner, id: string, side: 'buy' | 'sell', now: number): boolean {
    const trade = this.config.trades.find((t) => t.id === id);
    if (!trade || trade[side] <= 0) return false;
    let quota = owner.life.quotas[id];
    if (quota && now < quota.blockedUntil) return false;
    if (!quota || now >= quota.start + trade.windowMs) quota = { start: now, used: 0, blockedUntil: 0 };
    if (quota.used >= trade.quota) return false;
    const inv = new InventoryModel(owner.inv.toJSON());
    if (side === 'buy' ? owner.coins < trade.buy || !inv.add(trade.item) : !inv.takeItems(trade.item, 1)) return false;
    const coins = owner.coins + (side === 'buy' ? -trade.buy : trade.sell);
    if (!Number.isSafeInteger(coins) || coins < 0 || coins > 2_147_483_647) return false;
    owner.inv.load(inv.toJSON());
    owner.coins = coins;
    quota.used++;
    if (quota.used >= trade.quota) quota.blockedUntil = Math.max(now + trade.cooldownMs, quota.start + trade.windowMs);
    owner.life.quotas[id] = quota;
    return true;
  }
  eat(owner: LifeOwner, uid: number): boolean {
    const item = owner.inv.carriedItem(uid);
    const food = this.config.foods?.find((f) => f.item === item?.itemId);
    if (!item || !food) return false;
    owner.inv.remove(uid);
    owner.life.capacity = Math.min(this.config.stamina.maximum, owner.life.capacity + food.recovery);
    owner.life.stamina = Math.min(owner.life.capacity, owner.life.stamina + food.recovery);
    if (food.saturationMs) owner.life.fullUntil = Math.max(owner.life.fullUntil ?? 0, Date.now() + food.saturationMs);
    return true;
  }
}
