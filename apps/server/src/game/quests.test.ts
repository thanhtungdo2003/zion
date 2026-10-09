import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, InventoryModel, validateContent } from '@zion/shared';
import { QuestEngine, type QuestOwner } from './quests';

const now = Date.UTC(2026, 9, 9, 12);
function fixture() {
  const content = structuredClone(DEFAULT_CONTENT);
  const engine = new QuestEngine(content);
  const owner: QuestOwner = { journal: {}, inv: new InventoryModel(), coins: 100 };
  return { content, engine, owner };
}
describe('authoritative quest engine', () => {
  it('ships three pools of 3 daily / 7 long-term quests and five external missions', () => {
    expect(validateContent(DEFAULT_CONTENT)).toMatchObject({ ok: true });
    for (const npc of DEFAULT_CONTENT.npcs) {
      const pool = DEFAULT_CONTENT.quests.filter((q) => q.npc === npc.id);
      expect(pool).toHaveLength(10);
      expect(pool.filter((q) => q.kind === 'daily')).toHaveLength(3);
      expect(pool.filter((q) => q.objectives.some((o) => ['kill', 'visit', 'retrieve'].includes(o.type))).length).toBeGreaterThanOrEqual(5);
    }
  });
  it('enforces prerequisites and duplicate acceptance', () => {
    const { engine, owner } = fixture();
    expect(engine.accept(owner, 'farm_l_cell', now)).toBe(false);
    expect(engine.accept(owner, 'farm_d_potatoes', now)).toBe(true);
    expect(engine.accept(owner, 'farm_d_potatoes', now)).toBe(false);
    expect(engine.turnIn(owner, 'farm_d_potatoes', now)).toBe(false);
    expect(owner.coins).toBe(100);
  });
  it('consumes delivery once and cannot claim again after serialization', () => {
    const { engine, owner } = fixture();
    for (let i = 0; i < 6; i++) owner.inv.add('potato');
    engine.accept(owner, 'farm_d_potatoes', now);
    expect(engine.turnIn(owner, 'farm_d_potatoes', now)).toBe(true);
    expect(owner.inv.countOf('potato')).toBe(0);
    expect(owner.coins).toBe(160);
    owner.journal = JSON.parse(JSON.stringify(owner.journal));
    expect(engine.turnIn(owner, 'farm_d_potatoes', now)).toBe(false);
    expect(owner.coins).toBe(160);
  });
  it('daily boundary keeps long-term state', () => {
    const { engine, owner, content } = fixture();
    content.dailyResetHourUtc = 7;
    const start = Date.UTC(2026, 9, 9, 6, 59);
    engine.accept(owner, 'farm_d_potatoes', start);
    engine.accept(owner, 'farm_l_pork', start);
    engine.reset(owner, start + 120_000);
    expect(owner.journal.farm_d_potatoes).toBeUndefined();
    expect(owner.journal.farm_l_pork?.status).toBe('active');
  });
  it('quest items are real tagged inventory items placed at exact spots', () => {
    const { engine, owner } = fixture();
    const other: QuestOwner = { journal: {}, inv: new InventoryModel(), coins: 100 };
    engine.accept(owner, 'farm_l_coal', now);
    expect(engine.missingDrops(owner, 'farm_l_coal')).toBe(1);
    owner.journal.farm_l_coal!.drops = [{ x: 100, z: 100 }];
    expect(engine.retrieve(owner, 'farm_l_coal', 0, 0, 0, now)).toBe(false);
    expect(engine.retrieve(other, 'farm_l_coal', 0, 100, 100, now)).toBe(false);
    expect(engine.turnIn(owner, 'farm_l_coal', now)).toBe(false);
    expect(engine.retrieve(owner, 'farm_l_coal', 0, 100, 100, now)).toBe(true);
    expect(owner.inv.countTagged('coal_carton', 'farm_l_coal')).toBe(1);
    expect(engine.retrieve(owner, 'farm_l_coal', 0, 100, 100, now)).toBe(false);
    // Cancel + re-accept: the carried item still counts.
    expect(engine.cancel(owner, 'farm_l_coal')).toBe(true);
    expect(engine.accept(owner, 'farm_l_coal', now)).toBe(true);
    expect(owner.journal.farm_l_coal?.stage).toBe(1);
    expect(engine.turnIn(owner, 'farm_l_coal', now)).toBe(true);
    expect(owner.inv.countOf('coal_carton')).toBe(0);
    expect(owner.coins).toBe(300);
    expect(other.coins).toBe(100);
  });
  it('a lost quest item sends the quest back to the search step', () => {
    const { engine, owner } = fixture();
    engine.accept(owner, 'farm_l_coal', now);
    owner.journal.farm_l_coal!.drops = [{ x: 0, z: 0 }];
    engine.retrieve(owner, 'farm_l_coal', 0, 0, 0, now);
    expect(owner.journal.farm_l_coal?.stage).toBe(1);
    owner.inv.remove(owner.inv.items.find((i) => i.quest)!.uid);
    // An untagged carton does not count.
    owner.inv.add('coal_carton');
    expect(engine.turnIn(owner, 'farm_l_coal', now)).toBe(false);
    expect(owner.journal.farm_l_coal?.stage).toBe(0);
    expect(engine.missingDrops(owner, 'farm_l_coal')).toBe(1);
  });
  it('rolls back all delivery and reward changes when inventory is full', () => {
    const { engine, owner, content } = fixture();
    const quest = content.quests.find((q) => q.id === 'farm_d_potatoes')!;
    // More than the bag and all three storage pages can hold.
    quest.rewards.items = [{ item: 'coal_carton', count: 200 }];
    for (let i = 0; i < 6; i++) owner.inv.add('potato');
    engine.accept(owner, quest.id, now);
    const before = owner.inv.toJSON();
    expect(engine.turnIn(owner, quest.id, now)).toBe(false);
    expect(owner.inv.toJSON()).toEqual(before);
    expect(owner.coins).toBe(100);
    expect(owner.journal[quest.id]?.stage).toBe(0);
  });
  it('counts only the active stage and supports cancellation without stale cargo', () => {
    const { engine, owner } = fixture();
    engine.accept(owner, 'farm_l_coal', now);
    expect(engine.event(owner, { type: 'kill', target: 'zombie' }, now)).toBe(false);
    expect(engine.cancel(owner, 'farm_l_coal')).toBe(true);
    expect(engine.turnIn(owner, 'farm_l_coal', now)).toBe(false);
    expect(engine.accept(owner, 'farm_l_coal', now)).toBe(true);
  });
  it('rewards that do not fit in the bag go to the camp storage', () => {
    const { engine, owner, content } = fixture();
    const quest = content.quests.find((q) => q.id === 'farm_d_potatoes')!;
    quest.rewards.items = [{ item: 'coal_carton', count: 20 }];
    for (let i = 0; i < 6; i++) owner.inv.add('potato');
    engine.accept(owner, quest.id, now);
    expect(engine.turnIn(owner, quest.id, now)).toBe(true);
    const stashed = owner.inv.items.filter((i) => i.container.startsWith('stash_')).length;
    expect(stashed).toBeGreaterThan(0);
    expect(owner.inv.items.filter((i) => i.itemId === 'coal_carton').length).toBe(20);
    // Storage is not carried: it never counts for deliveries.
    expect(owner.inv.countOf('coal_carton')).toBe(20 - stashed);
  });
  it('rejects unknown items, prerequisite cycles and missing primary quest definitions', () => {
    const { content } = fixture();
    content.quests[0]!.rewards.items = [{ item: 'invalid', count: 1 }];
    content.quests[0]!.prereq = [content.quests[1]!.id];
    content.quests[1]!.prereq = [content.quests[0]!.id];
    expect(validateContent(content)).toMatchObject({ ok: false });
    expect(validateContent({ ...DEFAULT_CONTENT, quests: [] })).toMatchObject({ ok: false });
  });
});
