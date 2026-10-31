import { describe, expect, it } from 'vitest';
import type { WarfareSide } from '@zion/shared';
import { WarfareDirector, ledObjective, type DirectorUnit, type DirectorZone } from './warfare-director';

const bases = { blue: { x: -100, y: 0, z: 0 }, red: { x: 100, y: 0, z: 0 } };
const zone = (id: string, x: number, owner: WarfareSide | null = null, extra: Partial<DirectorZone> = {}): DirectorZone => ({
  id, name: id.toUpperCase(), x, z: 0, y: 0, radius: 10, owner, progress: owner === 'blue' ? 1 : owner === 'red' ? -1 : 0, contested: false, value: 1, links: [], points: [], spawns: [], ...extra,
});
const units = (list: Array<Partial<DirectorUnit> & { id: number; side: WarfareSide }>) => new Map(list.map((u) => [u.id, { x: bases[u.side].x, y: 0, z: 0, health: 100, alive: true, fighting: false, ...u }]));
const none = new Map<string, Record<WarfareSide, number>>();

describe('warfare director', () => {
  it('spreads squads over the zones instead of sending everyone to one', () => {
    const d = new WarfareDirector(bases, 2);
    const list = [];
    for (let i = 1; i <= 8; i++) { d.enlist(i, 'blue'); list.push({ id: i, side: 'blue' as const }); }
    const zones = [zone('a', -40), zone('b', 0), zone('c', 40)];
    d.think(0, zones, units(list), none, true);
    const targets = d.tasks('blue').map((t) => t.zone);
    expect(targets).toHaveLength(4);
    expect(new Set(targets).size).toBeGreaterThanOrEqual(2);
    // Every member has somewhere to go.
    const { objectives } = d.think(100, zones, units(list), none);
    expect(objectives.size).toBe(8);
  });

  it('keeps a task until it is done, then moves on (never back to a zone already taken)', () => {
    const d = new WarfareDirector(bases, 4);
    for (let i = 1; i <= 4; i++) d.enlist(i, 'blue');
    const u = units([1, 2, 3, 4].map((id) => ({ id, side: 'blue' as const })));
    const zones = [zone('a', -40), zone('b', 40)];
    d.think(0, zones, u, none, true);
    const first = d.tasks('blue')[0]!;
    expect(first).toMatchObject({ kind: 'attack', zone: 'a' });
    d.think(5000, zones, u, none, true);
    expect(d.tasks('blue')[0]!.zone).toBe('a');
    // Taken: the squad moves on to the next zone.
    zones[0]!.owner = 'blue'; zones[0]!.progress = 1;
    d.think(10_000, zones, u, none, true);
    expect(d.tasks('blue')[0]).toMatchObject({ kind: 'attack', zone: 'b' });
  });

  it('after taking a zone, goes on to objectives across the map instead of standing in it', () => {
    const d = new WarfareDirector(bases, 4);
    for (let i = 1; i <= 8; i++) d.enlist(i, 'blue');
    const u = units([1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, side: 'blue' as const })));
    // Just taken a zone by our base; the only others are far over the map.
    const zones = [zone('taken', -60, 'blue'), zone('far', 600, 'red'), zone('farther', 900)];
    d.think(0, zones, u, none, true);
    const tasks = d.tasks('blue');
    expect(tasks.filter((t) => t.kind === 'attack').length).toBeGreaterThanOrEqual(1);
    expect(tasks.filter((t) => t.zone === 'taken').length).toBeLessThanOrEqual(1);
  });

  it('everything held and quiet: squads patrol from zone to zone', () => {
    const d = new WarfareDirector(bases, 4);
    for (let i = 1; i <= 4; i++) d.enlist(i, 'blue');
    const u = units([1, 2, 3, 4].map((id) => ({ id, side: 'blue' as const })));
    const zones = [zone('a', -40, 'blue'), zone('b', 0, 'blue'), zone('c', 40, 'blue')];
    d.think(0, zones, u, none, true);
    const first = d.tasks('blue')[0]!.zone;
    d.think(60_000, zones, u, none, true);
    expect(d.tasks('blue')[0]!.zone).not.toBe(first);
  });

  it('rushes to a held zone under attack and calls for reinforcements', () => {
    const d = new WarfareDirector(bases, 2);
    for (let i = 1; i <= 6; i++) d.enlist(i, 'blue');
    const u = units([1, 2, 3, 4, 5, 6].map((id) => ({ id, side: 'blue' as const })));
    const zones = [zone('home', -40, 'blue'), zone('far', 60)];
    const presence = new Map([['home', { blue: 0, red: 3 }], ['far', { blue: 0, red: 0 }]]);
    const { calls } = d.think(0, zones, u, presence, true);
    expect(d.tasks('blue').some((t) => t.zone === 'home' && t.kind === 'reinforce')).toBe(true);
    expect(calls).toEqual([expect.objectContaining({ side: 'blue', zone: expect.objectContaining({ id: 'home' }) })]);
    // Not called again straight away.
    expect(d.think(1000, zones, u, presence).calls).toHaveLength(0);
  });

  it('a new leader takes over when the leader falls; a hurt bot in a fight falls back', () => {
    const d = new WarfareDirector(bases, 4);
    for (let i = 1; i <= 3; i++) d.enlist(i, 'red');
    const zones = [zone('a', 0)];
    const u = units([{ id: 1, side: 'red', alive: false }, { id: 2, side: 'red', health: 20, fighting: true, x: 0, z: 5 }, { id: 3, side: 'red' }]);
    const { objectives } = d.think(0, zones, u, none, true);
    expect([...d.squads.values()][0]!.leader).toBe(2);
    // Retreating: towards its base (no zone of its own), running.
    expect(objectives.get(2)).toMatchObject({ x: 100, sprint: true });
    expect(objectives.has(1)).toBe(false);
  });

  it('recruited bots leave their AI squad; orders put them in a wedge or at the point', () => {
    const d = new WarfareDirector(bases, 4);
    d.enlist(1, 'blue'); d.enlist(2, 'blue');
    d.discharge(1);
    expect(d.squadIdOf(1)).toBeUndefined();
    const leader = { x: 0, y: 0, z: 0, yaw: 0 };
    const f0 = ledObjective({ kind: 'follow' }, leader, 0, { x: 0, y: 0, z: 0 });
    const f1 = ledObjective({ kind: 'follow' }, leader, 1, { x: 0, y: 0, z: 0 });
    // Behind the leader (yaw 0 faces -z: behind is +z), one each side.
    expect(f0.z).toBeGreaterThan(0); expect(f1.z).toBeGreaterThan(0);
    expect(Math.sign(f0.x)).toBe(-Math.sign(f1.x));
    const m = ledObjective({ kind: 'move', x: 30, z: -20 }, leader, 0, { x: 0, y: 0, z: 0 });
    expect(m).toMatchObject({ x: 30, z: -20 });
  });
});
