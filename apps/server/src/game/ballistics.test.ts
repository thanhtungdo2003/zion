import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { WeaponId, TICK_DT, type BallisticState, type ProjectileSpec, type InputMessage } from '@zion/shared';
import { GameServer } from './game-server';
import { Player } from './player';
import type { ClientSession } from './session';

interface Harness {
  rounds: Array<BallisticState & { id: number; spec: ProjectileSpec }>;
  tryShoot(p: Player, now: number, renderTime?: number, bore?: InputMessage['bore']): void;
  stepRounds(now: number): void;
  hitTarget: ReturnType<typeof vi.fn>;
  broadcastAt: ReturnType<typeof vi.fn>;
}

function setup(wall = false) {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const collision = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) collision.addChunk(x, z,
    new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)),
    wall && x === 0 && z === 1 ? [{ shape: makeBox(16, 1.5, 49, 2, 1.5, .01), layer: Layer.Static }] : []);
  const session = { sendJson: vi.fn() } as unknown as ClientSession;
  const shooter = new Player(1, 'shooter', 'Shooter', session, 16, 0, 70);
  const target = new Player(2, 'target', 'Target', session, 16, 0, 25);
  shooter.weapon = WeaponId.AK47;
  shooter.active = target.active = true;
  shooter.life = { stamina: 100 } as Player['life'];
  const server = Object.assign(Object.create(GameServer.prototype), {
    rounds: [], nextGrenadeId: 1, collision, scratch: [],
    players: new Map([[shooter.id, shooter], [target.id, target]]),
    grid: { query: () => [shooter, target] }, zombies: { near: () => [], alert: vi.fn() }, animals: new Map(),
    allied: () => false, npcOnRay: () => null,
    vehicles: { hitAt: vi.fn() },
    life: { spend: vi.fn() }, attackStaminaCost: () => 0, useRound: () => true,
    broadcastNear: vi.fn(), broadcastAt: vi.fn(), hitTarget: vi.fn(),
  }) as Harness;
  const step = (now: number) => {
    target.history.push(now, target.state.x, target.state.y, target.state.z, target.yaw);
    server.stepRounds(now);
  };
  return { server, shooter, target, step };
}

afterEach(() => vi.restoreAllMocks());

describe('authoritative bullet flight', () => {
  it('launches the real bullet from the animated muzzle along the visible barrel', () => {
    const { server, shooter } = setup();
    const bore = { x: .23, y: 1.42, z: -.85, dx: 1, dy: 0, dz: 0 };
    server.tryShoot(shooter, 1000, undefined, bore);
    const round = server.rounds[0]!;
    expect(round.x).toBeCloseTo(shooter.state.x + bore.x);
    expect(round.y).toBeCloseTo(shooter.state.y + bore.y);
    expect(round.z).toBeCloseTo(shooter.state.z + bore.z);
    expect(round.vx).toBeGreaterThan(0);
    expect(round.vy).toBeCloseTo(0); expect(round.vz).toBeCloseTo(0);
  });
  it('keeps an animated muzzle behind cover from spawning a bullet through a wall', () => {
    const { server, shooter, step } = setup(true);
    shooter.state.z = 50;
    server.tryShoot(shooter, 1000, undefined, { x: 0, y: 1.4, z: -1.5, dx: 0, dy: 0, dz: -1 });
    expect(server.rounds[0]!.z).toBeGreaterThan(49);
    step(1000 + TICK_DT * 1000);
    expect(server.rounds).toHaveLength(0);
    expect(server.hitTarget).not.toHaveBeenCalled();
  });
  it('does not damage on trigger pull; reaches the target after multiple simulation ticks', () => {
    const { server, shooter, target, step } = setup();
    server.tryShoot(shooter, 1000);
    expect(server.rounds).toHaveLength(1);
    expect(server.hitTarget).not.toHaveBeenCalled();
    step(1000 + TICK_DT * 1000);
    expect(server.hitTarget).not.toHaveBeenCalled();
    for (let tick = 2; tick <= 4; tick++) step(1000 + tick * TICK_DT * 1000);
    expect(server.hitTarget).toHaveBeenCalledOnce();
    expect(server.hitTarget.mock.calls[0]![1]).toBe(target);
    expect(server.rounds).toHaveLength(0);
  });

  it('sweeps the complete flight segment and stops at a thin wall before the target', () => {
    const { server, shooter, step } = setup(true);
    server.tryShoot(shooter, 1000);
    for (let tick = 1; tick <= 5; tick++) step(1000 + tick * TICK_DT * 1000);
    expect(server.hitTarget).not.toHaveBeenCalled();
    expect(server.rounds).toHaveLength(0);
    expect(server.broadcastAt).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.objectContaining({ t: 'projEnd', z: expect.closeTo(49, 1), normal: [0, 0, 1] }));
  });

  it('checks current target positions rather than damaging a body that moved before arrival', () => {
    const { server, shooter, target, step } = setup();
    server.tryShoot(shooter, 1000, 800);
    target.state.x = 22;
    for (let tick = 1; tick <= 10; tick++) step(1000 + tick * TICK_DT * 1000);
    expect(server.hitTarget).not.toHaveBeenCalled();
    expect(server.rounds).toHaveLength(0);
  });
});
