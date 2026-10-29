import { describe, expect, it } from 'vitest';
import { InventoryModel } from './inventory';
import { ITEMS, ammoItemFor } from './items';
import {
  RespawnQueue, SquadBook, TicketLedger, VehicleSlot, WARFARE_CLASSES, WARFARE_DEFAULTS, WARFARE_KITS, ZoneCapture, autoWarfareLayout,
  emoteOrder, parseWarfareConfig, sanitizeWarfareLoadout, pickRecruits, pickSide, resolveWarfareLayout, respawnAt, sideCaps, validateWarfareLayout, warfareInventory,
  warfareLayoutSchema,
} from './warfare';

describe('warfare config', () => {
  it('has the spec defaults', () => {
    expect(WARFARE_DEFAULTS.tickets).toBe(300);
    expect(WARFARE_DEFAULTS.maxActive).toBe(50);
    expect(WARFARE_DEFAULTS.respawnSeconds).toBe(7);
  });
  it('falls back field by field on bad input and never throws', () => {
    const c = parseWarfareConfig({ tickets: -5, maxActive: 999, respawnSeconds: 'x', followerCap: 3, vehicles: 'nope' });
    expect(c.tickets).toBe(300);
    expect(c.maxActive).toBe(50);
    expect(c.respawnSeconds).toBe(7);
    expect(c.followerCap).toBe(3);
    expect(c.vehicles.enabled).toBe(true);
    expect(parseWarfareConfig(null).tickets).toBe(300);
    expect(parseWarfareConfig('garbage').maxActive).toBe(50);
  });
});

describe('warfare layout', () => {
  it('auto layout is valid and round-trips through the schema', () => {
    for (const half of [30, 90, 170]) {
      const l = autoWarfareLayout(half);
      expect(validateWarfareLayout(l, half)).toEqual([]);
      const back = warfareLayoutSchema.parse(JSON.parse(JSON.stringify(l)));
      expect(back).toEqual(l);
    }
  });
  it('rejects duplicate ids and missing bases, falling back to auto', () => {
    const bad = { zones: [{ id: 'a', name: 'A', x: 0, z: 0, radius: 8, owner: null }, { id: 'a', name: 'B', x: 10, z: 0, radius: 8, owner: null }], vehicleSpawns: [] };
    const parsed = warfareLayoutSchema.parse(bad);
    expect(validateWarfareLayout(parsed).length).toBeGreaterThan(0);
    const r = resolveWarfareLayout(parsed, 100);
    expect(r.auto).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('tickets', () => {
  it('a death costs exactly one ticket, even if reported twice', () => {
    const t = new TicketLedger(300);
    t.running = true;
    expect(t.death('blue', 'death:5:1')).toBe(true);
    expect(t.death('blue', 'death:5:1')).toBe(false);
    expect(t.tickets.blue).toBe(299);
    expect(t.tickets.red).toBe(300);
  });
  it('charges nothing while not running', () => {
    const t = new TicketLedger(300);
    expect(t.death('red', 'k')).toBe(false);
    t.bleed({ blue: 5, red: 0 }, 5, 1, 10);
    expect(t.tickets.red).toBe(300);
  });
  it('bleed hits the side holding fewer zones and is capped', () => {
    const t = new TicketLedger(300);
    t.running = true;
    for (let i = 0; i < 10; i++) t.bleed({ blue: 4, red: 1 }, 1, .2, 1);
    expect(t.tickets.blue).toBe(300);
    expect(t.tickets.red).toBe(300 - 6);
    const u = new TicketLedger(300);
    u.running = true;
    for (let i = 0; i < 10; i++) u.bleed({ blue: 9, red: 0 }, 1, 5, 1);
    expect(u.tickets.red).toBe(290);
  });
  it('a side at 0 loses and cannot respawn', () => {
    const t = new TicketLedger(10);
    t.running = true;
    for (let i = 0; i < 12; i++) t.death('red', `d${i}`);
    expect(t.tickets.red).toBe(0);
    expect(t.canRespawn('red')).toBe(false);
    expect(t.loser()).toBe('red');
  });
});

describe('zones', () => {
  const layout = [{ id: 'a', name: 'A', x: 0, z: 0, radius: 10, owner: null }];
  it('captures over time, faster with more units, and stalls when contested', () => {
    const zc = new ZoneCapture(layout);
    const one = zc.presence([{ side: 'blue', x: 1, z: 1 }]);
    let flips = zc.step(one, 6, 12, .25);
    expect(flips).toEqual([]);
    flips = zc.step(one, 6, 12, .25);
    expect(flips[0]?.to).toBe('blue');
    expect(zc.held()).toEqual({ blue: 1, red: 0 });
    const contested = zc.presence([{ side: 'blue', x: 1, z: 1 }, { side: 'red', x: 0, z: 0 }]);
    zc.step(contested, 30, 12, .25);
    expect(zc.zones[0]!.owner).toBe('blue');
    expect(zc.zones[0]!.contested).toBe(true);
  });
  it('an enemy must neutralise before capturing', () => {
    const zc = new ZoneCapture([{ ...layout[0]!, owner: 'blue' }]);
    const red = zc.presence([{ side: 'red', x: 0, z: 0 }]);
    const f1 = zc.step(red, 13, 12, 0);
    expect(f1[0]).toMatchObject({ from: 'blue', to: null });
    const f2 = zc.step(red, 12, 12, 0);
    expect(f2[0]).toMatchObject({ from: null, to: 'red' });
  });
});

describe('allocation & respawn', () => {
  it('never exceeds the active cap', () => {
    for (const [b, r] of [[0, 0], [1, 0], [3, 2], [25, 0], [30, 30], [40, 5]] as const) {
      const c = sideCaps({ blue: b, red: r }, 50);
      expect(c.blue.humans + c.blue.bots + c.red.humans + c.red.bots).toBeLessThanOrEqual(50);
      expect(c.blue.bots).toBeGreaterThanOrEqual(0);
      expect(c.red.bots).toBeGreaterThanOrEqual(0);
    }
    expect(sideCaps({ blue: 1, red: 0 }, 50)).toEqual({ blue: { humans: 1, bots: 24 }, red: { humans: 0, bots: 25 } });
  });
  it('balances sides', () => {
    expect(pickSide({ blue: 0, red: 0 })).toBe('blue');
    expect(pickSide({ blue: 2, red: 1 })).toBe('red');
  });
  it('respawns after the delay, once, within room and tickets', () => {
    const q = new RespawnQueue<number>();
    const at = respawnAt(1000, { respawnSeconds: 7 });
    expect(at).toBe(8000);
    expect(q.add(1, 'blue', at)).toBe(true);
    expect(q.add(1, 'blue', at)).toBe(false);
    q.add(2, 'red', at);
    q.add(3, 'blue', at + 1);
    expect(q.release(7999, 10, () => true)).toEqual([]);
    expect(q.release(8000, 10, (s) => s === 'blue')).toEqual([{ id: 1, side: 'blue' }]);
    expect(q.release(9000, 1, () => true)).toEqual([{ id: 2, side: 'red' }]);
    expect(q.size).toBe(1);
  });
});

describe('squads & orders', () => {
  it('squads respect size and side', () => {
    const s = new SquadBook(2);
    const id = s.create(1, 'blue');
    expect(s.join(2, 'red', id)).toBe(false);
    expect(s.join(2, 'blue', id)).toBe(true);
    expect(s.join(3, 'blue', id)).toBe(false);
    s.leave(1);
    expect(s.leader(2)).toBe(2);
    s.leave(2);
    expect(s.squads.size).toBe(0);
  });
  it('recruits the nearest bots within radius and room', () => {
    const bots = [{ id: 1, x: 30, z: 0 }, { id: 2, x: 5, z: 0 }, { id: 3, x: 10, z: 0 }, { id: 4, x: 2, z: 0 }];
    expect(pickRecruits({ x: 0, z: 0 }, bots, 25, 2).map((b) => b.id)).toEqual([4, 2]);
    expect(pickRecruits({ x: 0, z: 0 }, bots, 25, 0)).toEqual([]);
  });
  it('emotes map to orders', () => {
    expect(emoteOrder('point', { x: 3, z: 4 }, false)).toEqual({ kind: 'move', x: 3, z: 4 });
    expect(emoteOrder('point', { x: 3, z: 4 }, true)?.kind).toBe('attack');
    expect(emoteOrder('wave', null, false)?.kind).toBe('regroup');
    expect(emoteOrder('halt', null, false)?.kind).toBe('hold');
    expect(emoteOrder('salute', null, false)).toBeNull();
  });
});

describe('loadouts', () => {
  it('every class and every pick gives a valid, complete inventory', () => {
    for (const cls of WARFARE_CLASSES) {
      const k = WARFARE_KITS[cls];
      for (const id of [...k.primary, ...k.secondary, ...k.heavy, ...k.gadgets, k.head, k.chest]) expect(ITEMS[id], `${cls}: ${id}`).toBeDefined();
      for (const primary of k.primary) {
        const inv = warfareInventory(cls, { primary });
        const model = new InventoryModel(inv);
        expect(model.items.length, `${cls} ${primary}`).toBe(inv.items.length);
        expect(inv.items.some((i) => i.itemId === primary), `${cls} carries ${primary}`).toBe(true);
        // Ammunition for the main gun is in the pack.
        const ammo = ammoItemFor(primary);
        if (ammo) expect(inv.items.some((i) => i.itemId === ammo), `${cls} ${primary} ammo`).toBe(true);
        expect(inv.equipped).not.toBeNull();
      }
    }
  });
  it('refuses items outside the class and over the gadget limit', () => {
    const c = sanitizeWarfareLoadout('medic', { primary: 'barrett', gadgets: ['c4', 'smoke_grenade', 'flashbang', 'smoke_grenade'] });
    expect(c.primary).toBe('mp5');
    expect(c.gadgets).not.toContain('c4');
    expect(c.gadgets.length).toBeLessThanOrEqual(WARFARE_KITS.medic.maxGadgets);
    // An SMG main gun takes the secondary slot: no sidearm then.
    expect(c.secondary).toBeNull();
    const inv = warfareInventory('medic', { primary: 'barrett' });
    expect(inv.items.some((i) => i.itemId === 'barrett')).toBe(false);
  });
});

describe('vehicle slot lifecycle', () => {
  const spawn = { side: 'blue' as const, kind: 'jeep' as const, x: 0, z: 0, yaw: 0 };
  const cfg = { ...WARFARE_DEFAULTS.vehicles, wreckSeconds: 10, cooldownSeconds: 20, abandonSeconds: 60 };
  it('goes available → spawned → active → damaged → wreck → cleanup → cooldown → available', () => {
    const s = new VehicleSlot(0, spawn);
    expect(s.spawned(7, 0)).toBe(true);
    expect(s.spawned(8, 0)).toBe(false);
    s.tick(1000, cfg, true);
    expect(s.state).toBe('active');
    s.damaged(100, 850);
    expect(s.state).toBe('damaged');
    expect(s.destroyed(2000, cfg.wreckSeconds)).toBe(true);
    expect(s.destroyed(2000, cfg.wreckSeconds)).toBe(false);
    expect(s.tick(5000, cfg, false)).toBeNull();
    expect(s.tick(12000, cfg, false)).toBe('cleanup');
    expect(s.locked).toBe(true);
    s.cleaned(12000, cfg.cooldownSeconds);
    expect(s.state).toBe('cooldown');
    expect(s.tick(20000, cfg, false)).toBeNull();
    expect(s.tick(32000, cfg, false)).toBe('ready');
    expect(s.locked).toBe(false);
  });
  it('cleans up abandoned vehicles', () => {
    const s = new VehicleSlot(0, spawn);
    s.spawned(1, 0);
    expect(s.tick(61000, cfg, false)).toBe('cleanup');
  });
});
