import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, HUMANOID_RIG, Layer, makeBox } from '@zion/physics';
import { InventoryModel, WeaponId, WEAPON_SPECS } from '@zion/shared';
import { C4Charge, type StickyTarget } from './c4';
import { Player } from './player';
import { GameServer } from './game-server';
import type { ClientSession } from './session';

function world() {
  const w = new CollisionWorld({ worldSize: 64, seaLevel: -20 });
  for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
  return w;
}
function bomb(x = 16, y = 1, z = 16) {
  return new C4Charge(1, 'a', 1, { x, y, z, vx: 0, vy: 0, vz: -10, resting: false });
}
function mob(): StickyTarget { return { state: { x: 16, y: 0, z: 13 }, yaw: 0, active: true, dead: false, rig: HUMANOID_RIG }; }

describe('sticky C4 flight', () => {
  it('sticks to a wall instead of bouncing or reaching the mob behind it', () => {
    const collision = world();
    collision.setOwnerColliders(1, [{ shape: makeBox(16, 2, 14.5, 2, 2, .1), layer: Layer.Static }]);
    const c4 = bomb(), target = mob();
    for (let i = 0; i < 30; i++) c4.step(collision, [target], 1 / 30);
    expect(c4.s.resting).toBe(true);
    expect(c4.s.z).toBeGreaterThan(14.5);
    const z = c4.s.z;
    target.state.z += 5;
    c4.step(collision, [target], 1 / 30);
    expect(c4.s.z).toBe(z);
    expect(c4.nz).toBeCloseTo(1);
  });

  it('attaches to a mob and follows its translation and rotation', () => {
    const collision = world(), c4 = bomb(16, 1.6, 16), target = mob();
    target.state.z = 14;
    for (let i = 0; i < 12; i++) c4.step(collision, [target], 1 / 30);
    expect(c4.s.resting).toBe(true);
    const x = c4.s.x - target.state.x, y = c4.s.y - target.state.y, z = c4.s.z - target.state.z;
    target.state.x += 3; target.state.y += 1; target.yaw = Math.PI / 2;
    c4.step(collision, [target], 1 / 30);
    expect(c4.s.x).toBeCloseTo(target.state.x + z);
    expect(c4.s.y).toBeCloseTo(target.state.y + y);
    expect(c4.s.z).toBeCloseTo(target.state.z - x);
    target.dead = true;
    const pose = c4.pose();
    target.state.x += 10;
    c4.step(collision, [target], 1 / 30);
    c4.step(collision, [target], 1 / 30);
    expect(c4.pose()).toEqual(pose);
  });

  it('passes through players and rests on the ground until explicitly detonated', () => {
    const collision = world(), c4 = bomb();
    const player = new Player(1, 'b', 'B', {} as ClientSession, 16, 0, 15);
    player.active = true;
    c4.step(collision, [player], .1);
    expect(c4.s.resting).toBe(false);
    for (let i = 0; i < 60; i++) c4.step(collision, [player], 1 / 30);
    expect(c4.s.resting).toBe(true);
    expect(c4.s.z).toBeLessThan(14);
    expect(c4.s.y).toBeGreaterThanOrEqual(0);
    const pose = c4.pose();
    for (let i = 0; i < 300; i++) c4.step(collision, [], 1 / 30);
    expect(c4.pose()).toEqual(pose);
  });
});

interface C4Server {
  c4Charges: Map<number, C4Charge>;
  tryThrowC4(p: Player, now: number, distance?: number): void;
  tryDetonateC4(p: Player, now: number): void;
  sendInv: ReturnType<typeof vi.fn>;
  explode: ReturnType<typeof vi.fn>;
}
function serverFixture() {
  const collision = world();
  const server = Object.assign(Object.create(GameServer.prototype), {
    collision, c4Charges: new Map(), nextGrenadeId: 1,
    life: { config: { stamina: { attack: 1 } }, spend: vi.fn(() => true) },
    syncLoadout: vi.fn(), sendInv: vi.fn(), explode: vi.fn(),
  }) as C4Server;
  const p = new Player(1, 'a', 'A', {} as ClientSession, 16, 0, 16);
  p.life = { stamina: 100 } as Player['life'];
  p.inv.add('c4');
  p.inv.equip(p.inv.items[0]!.uid);
  return { server, p, collision };
}

describe('C4 inventory and detonation authority', () => {
  it('keeps the same slot and UID, changes to a remote, and clamps flight to 8 metres', () => {
    const { server, p, collision } = serverFixture();
    const before = { ...p.inv.equippedItem()! };
    server.tryThrowC4(p, 100, 100);
    expect(p.inv.equippedItem()).toEqual({ ...before, itemId: 'c4_detonator', chargeId: 1 });
    expect(server.c4Charges.size).toBe(1);
    const c4 = [...server.c4Charges.values()][0]!;
    for (let i = 0; i < 90; i++) c4.step(collision, [], 1 / 30);
    expect(Math.hypot(c4.s.x - 16, c4.s.z - 16)).toBeLessThanOrEqual(8.1);
    const restored = new InventoryModel(p.inv.toJSON());
    expect(restored.equippedItem()?.itemId).toBe('c4_detonator');
    server.tryThrowC4(p, 2000, 8);
    expect(server.c4Charges.size).toBe(1);
  });

  it('requires the matching remote in hand and consumes it exactly once', () => {
    const { server, p } = serverFixture();
    server.tryDetonateC4(p, 0);
    expect(server.explode).not.toHaveBeenCalled();
    server.tryThrowC4(p, 100, 4);
    const remote = p.inv.equipped!;
    p.inv.equipped = null;
    server.tryDetonateC4(p, 200);
    expect(server.explode).not.toHaveBeenCalled();
    const thief = new Player(2, 'other-account', 'B', {} as ClientSession, 16, 0, 16);
    thief.inv.load(p.inv.toJSON()); thief.inv.equipped = remote;
    server.tryDetonateC4(thief, 200);
    expect(server.explode).not.toHaveBeenCalled();
    p.inv.equipped = remote;
    server.tryDetonateC4(p, 300);
    expect(server.explode).toHaveBeenCalledOnce();
    expect(server.c4Charges.size).toBe(0);
    expect(p.inv.get(remote)).toBeUndefined();
    const spec = WEAPON_SPECS[WeaponId.C4];
    if (spec.kind !== 'throw') throw new Error('C4 must be throwable');
    expect(server.explode.mock.calls[0]!.slice(4, 7)).toEqual([spec.radius, spec.damage, p]);
    server.tryDetonateC4(p, 400);
    expect(server.explode).toHaveBeenCalledOnce();
  });

  it('does not spend an item when stamina or cooldown blocks the throw', () => {
    const { server, p } = serverFixture();
    p.life.stamina = 0; server.tryThrowC4(p, 100, 4);
    p.life.stamina = 100; p.throwReadyAt = 1000; server.tryThrowC4(p, 100, 4);
    expect(p.inv.equippedItem()?.itemId).toBe('c4');
    expect(server.c4Charges.size).toBe(0);
  });

  it('does not confuse a new bomb with an abandoned one when an inventory UID is reused', () => {
    const { server, p } = serverFixture();
    server.tryThrowC4(p, 100, 4);
    const uid = p.inv.equipped!;
    p.inv.remove(uid);
    const replacement = p.inv.add('c4')!;
    expect(replacement.uid).toBe(uid);
    p.inv.equip(replacement.uid);
    server.tryThrowC4(p, 2000, 4);
    expect(p.inv.equippedItem()?.chargeId).toBe(2);
    server.tryDetonateC4(p, 2100);
    expect(server.explode.mock.calls[0]![0]).toBe(2);
    expect(server.c4Charges.has(1)).toBe(true);
  });
});
