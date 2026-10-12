import { describe, expect, it } from 'vitest';
import { CollisionWorld, Heightfield } from '@zion/physics';
import { Buttons, EntityFlags, type SelfState } from '@zion/shared';
import { LocalPlayer } from './prediction';

function setup() {
  const world = new CollisionWorld({ worldSize: 32, seaLevel: -50 });
  world.addChunk(0, 0, new Heightfield(0, 0, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), []);
  const player = new LocalPlayer(world, 16, 0, 16);
  player.state.grounded = true;
  return player;
}

function snapshot(player: LocalPlayer): SelfState {
  return {
    ...player.state,
    flags: EntityFlags.Grounded,
    health: 100,
  };
}

function rendered(player: LocalPlayer, alpha: number) {
  return ['x', 'y', 'z'].map((axis) => {
    const k = axis as 'x' | 'y' | 'z';
    return player.prev[k] + (player.state[k] - player.prev[k]) * alpha + player.correction[k];
  });
}

describe('movement reconciliation', () => {
  it('predicts prone movement and restores the authoritative stance before replaying pending inputs', () => {
    const player = setup();
    const command = player.step(0, 1, 0, 0, Buttons.Prone, undefined);
    expect(command.b & Buttons.Prone).toBeTruthy();
    expect(player.state.prone).toBe(true);
    const server = { ...snapshot(player), flags: EntityFlags.Grounded | EntityFlags.Prone };
    player.step(0, 1, 0, 0, Buttons.Prone, undefined);
    player.reconcile(server, 1);
    expect(player.state.prone).toBe(true);
    expect(Math.hypot(player.state.vx, player.state.vz)).toBeLessThan(1.2);
    player.step(0, 0, 0, 0, 0, undefined);
    expect(player.state.prone).toBe(false);
  });
  it.each([0, 0.25, 0.5, 0.9])('preserves the rendered running position at interpolation %s when corrected', (alpha) => {
    const player = setup();
    player.step(0, 1, 0, 0, Buttons.Sprint, undefined);
    const server = snapshot(player);
    // The next local input is still in flight when the server acknowledges the first.
    player.step(0, 1, 0, 0, Buttons.Sprint, undefined);
    server.x += 0.1; server.y += 0.05; server.z -= 0.15;
    const before = rendered(player, alpha);
    player.reconcile(server, 1);
    rendered(player, alpha).forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 8));
  });

  it('keeps repeated corrections continuous and still snaps large teleports', () => {
    const player = setup();
    for (let seq = 1; seq <= 8; seq++) {
      player.step(0, 1, 0, 0, Buttons.Sprint, undefined);
      const before = rendered(player, 0.3);
      const server = snapshot(player);
      server.z += seq % 2 ? 0.1 : -0.1;
      player.reconcile(server, seq);
      rendered(player, 0.3).forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 8));
      player.decayCorrection(1 / 60);
    }
    const server = snapshot(player);
    server.x += 5;
    player.reconcile(server, 8);
    expect(player.correction).toEqual({ x: 0, y: 0, z: 0 });
    expect(player.prev.x).toBe(player.state.x);
  });
});
