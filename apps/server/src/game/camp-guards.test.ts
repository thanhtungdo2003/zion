import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { EntityKind, NPC_ID_BASE, WeaponId, isZombieId, type EntityState } from '@zion/shared';
import { CampGuardDirector } from './camp-guards';
import { Zombie } from './zombies';
import { PoseHistory, type Player } from './player';

function setup() {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const collision = new CollisionWorld({ worldSize: 128, seaLevel: -50 });
  for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
    collision.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33,
      new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), []);
  }
  const shot = vi.fn(), hit = vi.fn();
  const director = new CampGuardDirector({ x: 32, y: 0, z: 32 }, collision, { shot, hit });
  const zombie = new Zombie(1_000_000, 29, 0, 89);
  const step = (now: number, players: Player[] = []) => {
    zombie.history.push(now, zombie.state.x, zombie.state.y, zombie.state.z, zombie.yaw);
    director.step([zombie], players, now);
  };
  return { collision, director, zombie, shot, hit, step };
}

afterEach(() => vi.restoreAllMocks());

describe('camp sentries', () => {
  it('spawns exactly three permanent AK guards at the entrance with separate entity ids', () => {
    const sim = setup();
    sim.director.step([], [], 0);
    const entities: EntityState[] = [];
    sim.director.entitiesFor({ state: { x: 32, z: 70 } } as Player, entities);
    expect(entities).toHaveLength(3);
    expect(new Set(entities.map(e => e.id)).size).toBe(3);
    for (const entity of entities) {
      expect(entity.kind).toBe(EntityKind.Guard);
      expect(entity.weapon).toBe(WeaponId.AK47);
      expect(entity.yaw).toBe(Math.PI);
      expect(isZombieId(entity.id)).toBe(false);
      expect(entity.id).toBeGreaterThanOrEqual(NPC_ID_BASE);
    }
    expect(new CampGuardDirector(null, sim.collision, { shot: vi.fn(), hit: vi.fn() }).guards).toHaveLength(0);
  });

  it('shoots visible zombies using the AK and stays at its post', () => {
    const sim = setup();
    const posts = sim.director.guards.map(g => [g.state.x, g.state.z]);
    sim.step(0);
    expect(sim.shot).toHaveBeenCalled();
    expect(sim.hit).toHaveBeenCalled();
    expect(sim.shot.mock.calls[0]![0].w).toBe(WeaponId.AK47);
    expect(sim.hit.mock.calls[0]![1]).toBe(sim.zombie);
    sim.director.guards.forEach((g, i) => {
      expect(g.state.x).toBeCloseTo(posts[i]![0]!, 3);
      expect(g.state.z).toBeCloseTo(posts[i]![1]!, 3);
    });
  });

  it('respects walls, range, corpses and unloaded terrain', () => {
    const sim = setup();
    sim.collision.setOwnerColliders(10, [{ shape: makeBox(32, 2, 84, 10, 2, 0.3), layer: Layer.Static }]);
    sim.step(0);
    expect(sim.shot).not.toHaveBeenCalled();
    sim.collision.removeOwnerColliders(10);
    sim.zombie.state.z = 120;
    sim.step(100);
    expect(sim.shot).not.toHaveBeenCalled();
    sim.zombie.state.z = 89;
    sim.zombie.dead = true;
    sim.step(200);
    expect(sim.shot).not.toHaveBeenCalled();
    sim.zombie.dead = false;
    sim.collision.removeChunk(0, 2);
    sim.collision.removeChunk(1, 2);
    sim.step(300);
    expect(sim.shot).not.toHaveBeenCalled();
  });

  it('obeys the fire interval and reloads after 30 rounds', () => {
    const sim = setup();
    const shotsFromFirst = () => sim.shot.mock.calls.filter(([event]) => event.shooterId === NPC_ID_BASE).length;
    sim.step(0);
    sim.step(50);
    expect(shotsFromFirst()).toBe(1);
    for (let t = 100; t <= 2900; t += 100) sim.step(t);
    expect(shotsFromFirst()).toBe(30);
    sim.step(5100);
    expect(shotsFromFirst()).toBe(30);
    sim.step(5200);
    expect(shotsFromFirst()).toBe(31);
  });

  it('does not shoot through a friendly player standing in the line of fire', () => {
    const sim = setup();
    const history = new PoseHistory();
    history.push(0, 29, 0, 84, 0);
    const player = { active: true, dead: false, history, rig: sim.director.guards[0]!.rig } as Player;
    sim.step(0, [player]);
    expect(sim.hit.mock.calls.filter(([guard]) => guard.id === NPC_ID_BASE)).toHaveLength(0);
  });

  it('backs away from a zombie that gets too close while facing it', () => {
    const sim = setup();
    const guard = sim.director.guards[0]!;
    sim.zombie.state.x = guard.state.x;
    sim.zombie.state.z = guard.state.z + 4;
    const startZ = guard.state.z;
    for (let t = 0; t < 1000; t += 50) sim.step(t);
    expect(guard.brain.mode).toBe('retreat');
    expect(guard.state.z).toBeLessThan(startZ - 0.5);
    expect(Math.abs(Math.abs(guard.yaw) - Math.PI)).toBeLessThan(0.2);
  });
});
