import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { BLUEPRINT_BY_ID, MATERIAL_HP, quantizeHeight, quantizeLocal, quantizeScale, structureOwner, treeHits, type PropInstance, type ServerJsonMessage, type StructureState } from '@zion/shared';
import { CollisionWorld, Heightfield, Mask, makeRayHit, piecesOf, structurePieceOf } from '@zion/physics';
import { BaseBuilding, type BuildingDeps } from './base-building';
import { Player } from './player';
import type { ClientSession } from './session';
import type { PhysicsChunkManager } from './physics-manager';
import type { WorldService } from '../world/world-service';
import type { ZombieDirector } from './zombies';

const GROUND = 20;
function setup() {
  const collision = new CollisionWorld({ worldSize: 512, seaLevel: 5 });
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) collision.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(GROUND), new Float32Array(1089).fill(NaN)), []);
  // One pine (2449) and one big rock (2468) in chunk (5, 5).
  const prop = (asset: number, x: number, z: number): PropInstance => ({ asset, lx: quantizeLocal(x - 160), lz: quantizeLocal(z - 160), yq: quantizeHeight(GROUND), rot: 0, scale: quantizeScale(1), group: 0 } as PropInstance);
  const props = [prop(2449, 170, 170), prop(2468, 180, 170)];
  const chunk = { cx: 5, cz: 5, lod: 0, props } as unknown as import('@zion/shared').ChunkData;
  const world = { peek: (cx: number, cz: number, lod: number) => (cx === 5 && cz === 5 && lod === 0 ? { data: chunk } : undefined) } as unknown as WorldService;
  const physics = { propFilter: null, reload: vi.fn() } as unknown as PhysicsChunkManager;
  const sent: ServerJsonMessage[] = [];
  const replies: string[] = [];
  const drops: Array<{ itemId: string; count?: number }> = [];
  const players: Player[] = [];
  const zombies = { near: () => [] } as unknown as ZombieDirector;
  const crates: Array<Array<[string, number]>> = [];
  const vehicles: string[] = [];
  let now = 1000;
  const deps: BuildingDeps = {
    collision, physics, world, registry: createDefaultRegistry(), zombies,
    camp: { x: 40, y: GROUND, z: 40 },
    players: () => players,
    broadcast: (m) => sent.push(m),
    reply: (_p, text) => replies.push(text),
    inventoryChanged: () => undefined,
    dropItem: (itemId, count) => drops.push({ itemId, count }),
    addCoins: (p, n) => { p.coins += n; },
    teammates: () => false,
    landCrate: (items) => crates.push(items),
    landVehicle: (kind) => { vehicles.push(kind); return true; },
    atArchitect: () => true,
    save: () => Promise.resolve(),
    error: (err) => { throw err; },
    now: () => now,
  };
  const b = new BaseBuilding(deps);
  const session = { sendJson: (m: ServerJsonMessage) => sent.push(m), id: 1 } as unknown as ClientSession;
  const p = new Player(1, 'acc', 'Builder', session, 170, GROUND, 173);
  p.inv.load({ items: [], equipped: null });
  p.life = { stamina: 100, capacity: 100, quotas: {} };
  p.state.grounded = true;
  players.push(p);
  return { b, p, sent, replies, drops, collision, physics, crates, vehicles, advance: (ms: number) => { now += ms; } };
}

describe('base building', () => {
  it('fells a tree with an axe, hides it from physics and yields logs that split into planks', () => {
    const { b, p, sent, physics } = setup();
    p.yaw = 0; // facing −Z: the pine at (170, 170) is 3 m ahead
    for (let i = 0; i < treeHits(1) - 1; i++) b.strike(p, 'fire_axe', 65, 1000 + i);
    expect(sent.some((m) => m.t === 'trees' && m.removed.length)).toBe(false);
    b.strike(p, 'fire_axe', 65, 2000);
    const trees = [...sent].reverse().find((m) => m.t === 'trees') as Extract<ServerJsonMessage, { t: 'trees' }>;
    expect(trees.removed).toHaveLength(1);
    expect(physics.reload).toHaveBeenCalledWith(5, 5);
    expect(physics.propFilter!(5, 5, { lx: quantizeLocal(10), lz: quantizeLocal(10) } as PropInstance)).toBe(false);
    // Another swing at the same spot no longer finds a tree.
    const before = sent.length;
    b.strike(p, 'fire_axe', 65, 2100);
    expect(sent.slice(before).some((m) => m.t === 'chop')).toBe(false);
    // F at the trunk: a 2 × 2 log; right-click it: four planks.
    const trunk = trees.trunks[0]!;
    b.takeLog(p, trunk.key, 2200);
    const log = p.inv.items.find((i) => i.itemId === 'wood_log')!;
    expect(log).toBeDefined();
    b.craft(p, log.uid);
    expect(p.inv.unitsOf('plank')).toBe(4);
    expect(p.inv.unitsOf('wood_log')).toBe(0);
  });

  it('mines a rock with a pickaxe: ore falls at its foot until the seam runs out', () => {
    const { b, p, drops, replies } = setup();
    Object.assign(p.state, { x: 176.5, z: 170 });
    p.yaw = -Math.PI / 2; // facing +X, at the rock
    for (let i = 0; i < 8; i++) b.strike(p, 'pickaxe', 36, 1000 + i * 1000);
    expect(drops.length).toBe(8);
    expect(drops.every((d) => ['stone', 'iron_ore', 'copper_ore', 'lead_ore'].includes(d.itemId))).toBe(true);
    b.strike(p, 'pickaxe', 36, 20_000);
    expect(drops.length).toBe(8);
    expect(replies.some((r) => r.includes('cạn'))).toBe(true);
  });

  it('trades materials for a blueprint, places it with real colliders and keeps the camp clear', () => {
    const { b, p, sent, collision, replies } = setup();
    const def = BLUEPRINT_BY_ID.get('wood_outpost')!;
    p.inv.addUnits('plank', 40); p.inv.addUnits('stone', 20);
    for (const item of Object.keys(def.cost)) b.deposit(p, def.id, item);
    expect(p.life.blueprints?.wood_outpost).toEqual({ plank: 32, stone: 10 });
    expect(p.inv.unitsOf('plank')).toBe(8);
    b.claim(p, def.id);
    const bp = p.inv.items.find((i) => i.itemId === def.item)!;
    expect(bp).toBeDefined();
    // Too close to the camp: refused.
    Object.assign(p.state, { x: 90, z: 100 });
    b.place(p, bp.uid, 90, 90, 0);
    expect(replies.at(-1)).toContain('100 m');
    // Out in the open: built.
    Object.assign(p.state, { x: 300, z: 309 });
    b.place(p, bp.uid, 300, 300, 0);
    const s = b.structures.values().next().value as StructureState;
    expect(replies.at(-1)).toContain('Đã xây');
    expect(s).toBeDefined();
    expect(p.inv.items.some((i) => i.itemId === def.item)).toBe(false);
    // A wall stops a ray and is tagged as this structure's piece.
    const hit = makeRayHit();
    expect(collision.raycast(300, GROUND + 1.2, 290, 0, 0, 1, 20, Mask.CharacterMovement, hit)).toBe(true);
    expect(structurePieceOf(hit.tag)?.id).toBe(s.id);
    expect(sent.some((m) => m.t === 'structure')).toBe(true);
  });

  it('wood gives way to bullets and blasts sooner than stone and metal; a lost core brings it down', () => {
    const { b, p, collision } = setup();
    const place = (bpItem: string, x: number) => {
      const it = p.inv.add(bpItem)!;
      Object.assign(p.state, { x, z: 309 });
      b.place(p, it.uid, x, 300, 0);
      return [...b.structures.values()].find((s) => s.x === x)!;
    };
    const wood = place('bp_wood_outpost', 200), stone = place('bp_stone_bunker', 260), metal = place('bp_metal_fortress', 330);
    const wall = (s: StructureState) => piecesOf(s.blueprint).findIndex((pc) => pc.kind === 'wall');
    for (const s of [wood, stone, metal]) b.damagePiece(s.id, wall(s), 100, 'bullet', 0, 0, 0);
    const lost = (s: StructureState, mat: keyof typeof MATERIAL_HP) => MATERIAL_HP[mat] - s.hp[wall(s)]!;
    expect(lost(wood, 'wood')).toBeGreaterThan(lost(stone, 'stone'));
    expect(lost(stone, 'stone')).toBeGreaterThan(lost(metal, 'metal'));
    // A blast hurts far more than a bullet.
    const before = wood.hp[wall(wood)]!;
    b.blast(200, GROUND + 1, 296, 4, 100);
    expect(before - wood.hp[wall(wood)]!).toBeGreaterThan(100);
    // The power core destroyed: the structure is gone, colliders and all.
    const core = piecesOf(wood.blueprint).findIndex((pc) => pc.kind === 'core');
    b.damagePiece(wood.id, core, 5000, 'melee', 0, 0, 0);
    expect(b.structures.has(wood.id)).toBe(false);
    const hit = makeRayHit();
    expect(collision.raycast(200, GROUND + 1.2, 290, 0, 0, 1, 4, Mask.CharacterMovement, hit) && hit.tag !== 0 && structurePieceOf(hit.tag)?.id === wood.id).toBe(false);
    void structureOwner;
  });

  it('opens doors for the owner only, then closes them by itself', () => {
    const { b, p, replies } = setup();
    const it = p.inv.add('bp_wood_outpost')!;
    Object.assign(p.state, { x: 300, z: 309 });
    b.place(p, it.uid, 300, 300, 0);
    const s = b.structures.values().next().value as StructureState;
    const door = piecesOf(s.blueprint).findIndex((pc) => pc.kind === 'door');
    Object.assign(p.state, { x: 300, z: 297 });
    b.door(p, s.id, door, 1000);
    expect(s.open).toContain(door);
    const stranger = new Player(2, 'other', 'Stranger', p.session, 300, GROUND, 297);
    b.door(stranger, s.id, door, 1000);
    expect(replies.at(-1)).toContain('khoá');
    Object.assign(p.state, { x: 330, z: 330 });
    b.step(1 / 30, 9000);
    expect(s.open).not.toContain(door);
  });

  it('orders a supply drop: pays, flies in, and lands a crate and a vehicle at the zone', () => {
    const { b, p, crates, vehicles, sent } = setup();
    p.inv.add('supply_radio');
    p.coins = 10_000;
    b.order(p, 'veh_quad', 0);
    expect(p.coins).toBe(10_000 - 1400);
    b.order(p, 'kit_assault', 0);
    expect(p.coins).toBe(10_000 - 1400);
    for (let t = 0; t < 90 * 30; t++) b.step(1 / 30, t * 33);
    expect(vehicles).toEqual(['quad']);
    p.coins = 10_000;
    b.order(p, 'kit_assault', 200_000);
    for (let t = 0; t < 90 * 30; t++) b.step(1 / 30, 200_000 + t * 33);
    expect(crates).toHaveLength(1);
    expect(crates[0]).toContainEqual(['ak47', 1]);
    expect(sent.some((m) => m.t === 'supply' && m.planes.length > 0)).toBe(true);
  });
});
