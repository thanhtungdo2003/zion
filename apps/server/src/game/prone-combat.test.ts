import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '@zion/physics';
import { castCombatRay } from './combat';
import { Player } from './player';
import type { ClientSession } from './session';

describe('prone hitboxes', () => {
  it('rewinds stance as well as position and hits the low body in every facing direction', () => {
    const session = {} as ClientSession;
    const attacker = new Player(1, 'a', 'Alpha', session, 10, 0, 20);
    const target = new Player(2, 'b', 'Bravo', session, 10, 0, 10);
    target.active = true;
    target.state.prone = true;
    const world = new CollisionWorld({ worldSize: 64, seaLevel: -50 });
    target.history.push(0, 10, 0, 10, 0, false);
    target.history.push(100, 10, 0, 10, 0, true);
    const highShot = (renderTime: number) => castCombatRay(attacker, [target], world, 100, renderTime, 10, 1.3, 20, 0, 0, -1, 30);
    expect(highShot(0).target).toBe(target);
    expect(highShot(100).target).toBeNull();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      target.history.clear();
      target.history.push(100, 10, 0, 10, yaw, true);
      const torsoX = 10 - Math.sin(yaw);
      const torsoZ = 10 - Math.cos(yaw);
      expect(castCombatRay(attacker, [target], world, 100, 100, torsoX, .3, torsoZ + 10, 0, 0, -1, 30).target).toBe(target);
    }
  });
});
