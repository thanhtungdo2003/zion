import { describe, expect, it, vi } from 'vitest';
import { ARMOR_SPECS, CHEST_SEARCH_MS, InventoryModel, type ChestData, type InventoryData, type ServerJsonMessage } from '@zion/shared';
import { SharedChests, type ChestHooks } from './chests';
import type { Player } from './player';

function player() {
  const sendJson = vi.fn<(m: ServerJsonMessage) => void>();
  const p = { inv: new InventoryModel(), questBusy: false, session: { open: true, sendJson } } as unknown as Player;
  return { p, sendJson };
}
function setup(field = true, stored: ChestData | null = null) {
  let time = 0; let day = 0;
  const hooks: ChestHooks = {
    near: () => ({ field }), load: vi.fn(async () => stored),
    commit: vi.fn(async (_id: string, _data: ChestData, _player?: Player, _inventory?: InventoryData) => undefined),
    sync: vi.fn(), finish: (p) => { p.questBusy = false; }, error: vi.fn(),
  };
  return { hooks, service: new SharedChests(hooks, () => time, () => day), advance: (ms: number) => { time += ms; }, nextDay: () => { day++; } };
}
const id = '2002:100:0:200';
const open = (service: SharedChests, p: Player) => service.handle(p, { t: 'inv', op: 'chestOpen', id });

describe('shared world chests', () => {
  it('opens a death crate immediately and preserves weapon magazines and armor durability', async () => {
    const inv = new InventoryModel();
    const gun = inv.add('ak47')!; gun.mag = 7;
    const armorId = ARMOR_SPECS[0]!.item;
    const armor = inv.add(armorId, 13)!;
    const { service, hooks } = setup(false, { items: inv.items, searched: true, revision: 0, capacity: 40 });
    const a = player();
    await open(service, a.p);
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searched: true, field: false, capacity: 40 });
    await service.handle(a.p, { t: 'inv', op: 'chestSearch', id });
    expect(hooks.commit).not.toHaveBeenCalled();
    await service.handle(a.p, { t: 'inv', op: 'chestTake', id, uid: gun.uid, revision: 0 });
    await service.handle(a.p, { t: 'inv', op: 'chestTake', id, uid: armor.uid, revision: 1 });
    expect(a.p.inv.items.find(item => item.itemId === 'ak47')?.mag).toBe(7);
    expect(a.p.inv.items.find(item => item.itemId === armorId)?.count).toBe(13);
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ items: [], revision: 2 });
  });
  it('loads once for concurrent viewers and broadcasts deposits with original magazine and charges', async () => {
    const { hooks, service } = setup(); const a = player(), b = player();
    await Promise.all([open(service, a.p), open(service, b.p)]);
    expect(hooks.load).toHaveBeenCalledTimes(1);
    const gun = a.p.inv.add('gl18')!; gun.mag = 4; gun.issued = true;
    await service.handle(a.p, { t: 'inv', op: 'chestPut', id, uid: gun.uid, revision: 0 });
    expect(a.p.inv.items).toHaveLength(0);
    const message = b.sendJson.mock.calls.at(-1)![0];
    expect(message).toMatchObject({ t: 'chest', revision: 1, items: [{ itemId: 'gl18', mag: 4, issued: true }] });
    expect(hooks.commit).toHaveBeenCalledWith(id, expect.objectContaining({ revision: 1 }), a.p, expect.objectContaining({ items: [] }));
  });

  it('gives a contested item to one player only and refuses stale revisions', async () => {
    const inv = new InventoryModel(); inv.add('medkit', 1);
    const { service } = setup(true, { items: inv.items, revision: 2, searched: true });
    const a = player(), b = player(); await Promise.all([open(service, a.p), open(service, b.p)]);
    await Promise.all([a.p, b.p].map((p) => service.handle(p, { t: 'inv', op: 'chestTake', id, uid: 1, revision: 2 })));
    expect(a.p.inv.items.length + b.p.inv.items.length).toBe(1);
    const survivor = [...a.p.inv.items, ...b.p.inv.items][0]!;
    expect(survivor.count).toBe(1);
    await service.handle(b.p, { t: 'inv', op: 'chestTake', id, uid: 1, revision: 2 });
    expect(a.p.inv.items.length + b.p.inv.items.length).toBe(1);
  });

  it('leaves both inventories unchanged when saving fails', async () => {
    const { hooks, service } = setup(); const a = player(); await open(service, a.p);
    const item = a.p.inv.add('ammo_9mm', 7)!;
    hooks.commit = vi.fn(async () => { throw new Error('database unavailable'); });
    await service.handle(a.p, { t: 'inv', op: 'chestPut', id, uid: item.uid, revision: 0 });
    expect(a.p.inv.get(item.uid)?.count).toBe(7);
    expect(a.p.questBusy).toBe(false);
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ t: 'chest', items: [], revision: 0, busy: false, error: expect.any(String) });
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it('performs one durable search and shares the loot with every viewer', async () => {
    const { hooks, service, advance } = setup(); const a = player(), b = player();
    await Promise.all([open(service, a.p), open(service, b.p)]);
    await service.handle(a.p, { t: 'inv', op: 'chestSearch', id });
    expect(b.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searchRemainingMs: CHEST_SEARCH_MS });
    advance(CHEST_SEARCH_MS - 1); service.step(); expect(hooks.commit).not.toHaveBeenCalled();
    advance(1); service.step();
    await vi.waitFor(() => expect(b.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searched: true, busy: false }));
    const message = b.sendJson.mock.calls.at(-1)![0];
    expect(message.t === 'chest' && message.items.length).toBeGreaterThanOrEqual(3);
    await service.handle(b.p, { t: 'inv', op: 'chestSearch', id });
    expect(hooks.commit).toHaveBeenCalledTimes(1);
  });

  it('cancels search on close or when the searcher leaves reach', async () => {
    const { hooks, service, advance } = setup(); const a = player();
    await open(service, a.p); await service.handle(a.p, { t: 'inv', op: 'chestSearch', id });
    await service.handle(a.p, { t: 'inv', op: 'chestClose' }); advance(CHEST_SEARCH_MS); service.step();
    expect(hooks.commit).not.toHaveBeenCalled();
    await open(service, a.p); await service.handle(a.p, { t: 'inv', op: 'chestSearch', id });
    hooks.near = () => null; advance(CHEST_SEARCH_MS); service.step();
    expect(hooks.commit).not.toHaveBeenCalled();
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ closed: true });
  });

  it('allows shared storage at camp but never rolls free camp loot', async () => {
    const { hooks, service, advance } = setup(false); const a = player();
    await open(service, a.p); await service.handle(a.p, { t: 'inv', op: 'chestSearch', id });
    advance(CHEST_SEARCH_MS); service.step(); expect(hooks.commit).not.toHaveBeenCalled();
    const item = a.p.inv.add('potato')!;
    await service.handle(a.p, { t: 'inv', op: 'chestPut', id, uid: item.uid, revision: 0 });
    expect(hooks.commit).toHaveBeenCalledTimes(1);
  });
  it('restocks field crates each world day but keeps base storage', async () => {
    const stored = (): ChestData => ({ items: [{ uid: 1, itemId: 'medkit', container: 'backpack', x: 0, y: 0, rotated: false }], searched: true, revision: 3, day: 0 });
    const field = setup(true, stored()); const a = player();
    await open(field.service, a.p);
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searched: true, items: [{ itemId: 'medkit' }] });
    field.nextDay(); await open(field.service, a.p);
    expect(a.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searched: false, items: [], revision: 4, day: 1 });
    const base = setup(false, stored()); const b = player();
    base.nextDay(); await open(base.service, b.p);
    expect(b.sendJson.mock.calls.at(-1)![0]).toMatchObject({ searched: true, items: [{ itemId: 'medkit' }] });
  });
});
