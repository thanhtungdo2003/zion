import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_LIFE, InventoryModel, planCooking } from '@zion/shared';
import { BaseLife, type LifeOwner, type LifeWorld } from './base-life';
function setup() {
  const config = structuredClone(DEFAULT_BASE_LIFE);
  const engine = new BaseLife(config);
  const owner: LifeOwner = { inv: new InventoryModel(), coins: 1000, life: engine.initial() };
  const world: LifeWorld = { plots: {}, nextGrowth: 0 };
  return { config, engine, owner, world };
}
describe('base life authoritative transactions', () => {
  it('consumes one planting item, prevents occupied plots, grows by ticks and yields exactly four potatoes once', () => {
    const { engine, owner, world } = setup();
    owner.inv.add('potato'); owner.inv.add('potato');
    expect(engine.plant(world, owner, 'plot_0', 'potato')).toBe(true);
    expect(owner.inv.countOf('potato')).toBe(1);
    expect(engine.plant(world, owner, 'plot_0', 'potato')).toBe(false);
    expect(engine.harvest(world, owner, 'plot_0')).toBeNull();
    engine.growth(world, 0, () => 0);
    expect(world.plots.plot_0?.stage).toBe(1);
    expect(engine.growth(world, 1, () => 0)).toBe(false);
    engine.growth(world, 10_000, () => 0);
    expect(engine.harvest(world, owner, 'plot_0')).toEqual({ item: 'potato', quantity: 4 });
    expect(owner.inv.countOf('potato')).toBe(5);
    expect(engine.harvest(world, owner, 'plot_0')).toBeNull();
  });
  it('failed randomized ticks do not advance growth', () => {
    const { engine, owner, world } = setup(); owner.inv.add('potato');
    engine.plant(world, owner, 'plot_0', 'potato');
    engine.growth(world, 100, () => 0.9);
    expect(world.plots.plot_0?.stage).toBe(0);
  });
  it('full inventory preserves mature crops', () => {
    const { engine, owner, world } = setup();
    world.plots.plot_0 = { crop: 'potato', stage: 2 };
    while (owner.inv.add('potato')) { /* fill backpack */ }
    expect(engine.harvest(world, owner, 'plot_0')).toBeNull();
    expect(world.plots.plot_0?.stage).toBe(2);
  });
  it('cooks every kind of ingredient in one batch, scales duration and rejects replay', () => {
    const { engine, owner, config } = setup();
    owner.inv.add('raw_mutton'); owner.inv.add('raw_mutton');
    owner.inv.add('raw_porkchop'); owner.inv.add('potato');
    config.recipes[1]!.durationMs = 6000;
    const batch = planCooking(config, owner.inv.items)!;
    expect(batch.quantity).toBe(4);
    expect(batch.durationMs).toBe(18_000);
    expect(engine.cook(owner, batch)).toEqual([
      { item: 'cooked_mutton', quantity: 2 },
      { item: 'cooked_porkchop', quantity: 1 },
      { item: 'potato_cooked', quantity: 1 },
    ]);
    expect(owner.inv.countOf('raw_mutton')).toBe(0);
    expect(owner.inv.countOf('raw_porkchop')).toBe(0);
    expect(owner.inv.countOf('potato')).toBe(0);
    expect(owner.inv.countOf('cooked_mutton')).toBe(2);
    expect(engine.cook(owner, batch)).toBeNull();
    expect(owner.inv.countOf('cooked_mutton')).toBe(2);
    expect(planCooking(config, owner.inv.items)).toBeNull();
  });
  it('excludes stored and issued food and keeps new ingredients for the next batch', () => {
    const { engine, owner, config } = setup();
    owner.inv.add('raw_mutton');
    const stored = owner.inv.add('potato')!; stored.container = 'stash_1';
    owner.inv.add('raw_porkchop', 1, true);
    const batch = planCooking(config, owner.inv.items)!;
    expect(batch.quantity).toBe(1);
    owner.inv.add('raw_mutton');
    expect(engine.cook(owner, batch)).toEqual([{ item: 'cooked_mutton', quantity: 1 }]);
    expect(owner.inv.countOf('raw_mutton')).toBe(1);
    expect(owner.inv.items.find((i) => i.uid === stored.uid)?.itemId).toBe('potato');
    expect(owner.inv.items.some((i) => i.itemId === 'raw_porkchop' && i.issued)).toBe(true);
  });
  it('rejects a batch atomically if an ingredient was removed while cooking', () => {
    const { engine, owner, config } = setup();
    owner.inv.add('raw_mutton');
    const potato = owner.inv.add('potato')!;
    const batch = planCooking(config, owner.inv.items)!;
    owner.inv.remove(potato.uid);
    const before = owner.inv.toJSON();
    expect(engine.cook(owner, batch)).toBeNull();
    expect(owner.inv.toJSON()).toEqual(before);
  });
  it('can cook a full backpack by freeing all ingredients before adding outputs', () => {
    const { engine, owner, config } = setup();
    while (owner.inv.add('potato')) { /* fill backpack */ }
    const batch = planCooking(config, owner.inv.items)!;
    expect(engine.cook(owner, batch)).toEqual([{ item: 'potato_cooked', quantity: batch.quantity }]);
    expect(owner.inv.countOf('potato_cooked')).toBe(batch.quantity);
  });
  it('shares buy and sell quota, preserves it on reconnect, and rejects requests until both window and cooldown expire', () => {
    const { engine, config, owner } = setup(); const t = config.trades[0]!;
    t.quota = 2; t.windowMs = 100; t.cooldownMs = 200;
    expect(engine.trade(owner, t.id, 'buy', 0)).toBe(true);
    expect(engine.trade(owner, t.id, 'sell', 1)).toBe(true);
    owner.life = JSON.parse(JSON.stringify(owner.life));
    expect(engine.trade(owner, t.id, 'buy', 101)).toBe(false);
    expect(engine.trade(owner, t.id, 'buy', 202)).toBe(true);
    expect(owner.coins).toBe(968);
  });
  it('rejects insufficient funds without burning quota', () => {
    const { engine, config, owner } = setup(); owner.coins = 0;
    expect(engine.trade(owner, config.trades[0]!.id, 'buy', 0)).toBe(false);
    expect(owner.life.quotas).toEqual({});
    expect(owner.inv.items).toHaveLength(0);
  });
  it('separates stamina from capacity, prevents overspending and recovers capacity only through configured food', () => {
    const { engine, owner } = setup();
    expect(engine.spend(owner.life, 20)).toBe(true);
    expect(owner.life.capacity).toBeCloseTo(99.7);
    expect(engine.spend(owner.life, 100)).toBe(false);
    engine.rest(owner.life, 10);
    expect(owner.life.stamina).toBe(owner.life.capacity);
    // Unconfigured items are not food; raw meat is, but fills little and wears off fast.
    const ammo = owner.inv.add('ammo_9mm')!;
    expect(engine.eat(owner, ammo.uid)).toBe(false);
    const raw = owner.inv.add('raw_mutton')!;
    expect(engine.eat(owner, raw.uid)).toBe(true);
    expect(owner.life.capacity).toBeCloseTo(100);
    const rawFull = owner.life.fullUntil!;
    const cooked = owner.inv.add('cooked_mutton')!;
    expect(engine.eat(owner, cooked.uid)).toBe(true);
    expect(owner.life.capacity).toBe(100);
    expect(owner.life.fullUntil! - rawFull).toBeGreaterThan(90_000);
    expect(engine.eat(owner, cooked.uid)).toBe(false);
  });
});
