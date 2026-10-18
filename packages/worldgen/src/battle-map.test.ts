import { describe, expect, it } from 'vitest';
import { assetColliders, createDefaultRegistry, BATTLE_ASSET, BRIDGE_ASSET } from '@zion/assets';
import { BATTLE_MAP, CHEST_ASSETS, propTransform, TICK_DT } from '@zion/shared';
import { CharacterController, CollisionWorld, Heightfield, createCharacterState, doorColliders, Mask, makeRayHit } from '../../physics/src/index';
import { WorldGenerator } from './generator';
import { normalizeSeed } from './config';
import { battleStructures, battleTower, modularBuilding } from './battle-map';
import { authoredWorld, ISLAND_ASSET } from './maps/authored';
import type { CampPart } from './camp';

const registry = createDefaultRegistry();
const config = { seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale' as const };
const gen = new WorldGenerator(config, registry);
describe('authored Battle Royale island', () => {
  it('is deterministic, has no safe camp, and provides the planned districts with loot', () => {
    const sites = battleStructures(gen), copy = new WorldGenerator(config, registry), world = authoredWorld(gen);
    expect(gen.camp).toBeNull();
    expect(battleStructures(copy)).toEqual(sites);
    expect(world.areas().map(a => a.kind)).toEqual(expect.arrayContaining(['port', 'town', 'military', 'power_plant', 'airfield', 'village']));
    expect(gen.roads!.segments.length).toBeGreaterThan(500);
    expect(gen.roads!.segments.some(s => s.paved)).toBe(true);
    for (const site of sites) {
      for (const part of site.parts) expect(registry.byNumericId(part.asset)).toBeDefined();
      if (site.radius > 2) {
        // Land districts sit on dry levelled pads.
        expect(site.y).toBeGreaterThan(gen.seaLevel + 1);
        expect(gen.heightAt(site.x, site.z)).toBeCloseTo(site.y, 0);
      }
    }
    const town = sites.filter(s => s.kind === 'town');
    expect(town.length).toBeGreaterThanOrEqual(16);
    expect(town.flatMap(s => s.parts).filter(p => CHEST_ASSETS.has(p.asset)).length).toBeGreaterThan(30);
    expect(town.some(s => s.parts.some(p => CHEST_ASSETS.has(p.asset) && p.y > 3))).toBe(true);
    expect(town.flatMap(s => s.parts).some(p => p.asset === BATTLE_ASSET.door)).toBe(true);
    expect(sites.flatMap(s => s.parts).filter(p => p.asset === ISLAND_ASSET.crane)).toHaveLength(3);
    expect(gen.findSpawnPoints(96, 65).length).toBeGreaterThanOrEqual(32);
    const s = sites[0]!, cx = Math.floor(s.x / 32), cz = Math.floor(s.z / 32);
    expect(gen.generateChunk(cx, cz, 0)).toEqual(copy.generateChunk(cx, cz, 0));
  });
  it('is an island with a harbour basin, woods and a power grid on land', () => {
    const size = gen.worldSize, sea = gen.seaLevel, world = authoredWorld(gen);
    for (let t = 0; t <= size; t += 256) for (const [x, z] of [[0, t], [size, t], [t, 0], [t, size]]) expect(gen.heightAt(x!, z!)).toBeLessThan(sea);
    expect(gen.heightAt(2100, 3420)).toBeLessThan(sea - 1);
    expect(gen.heightAt(1980, 2680)).toBeGreaterThan(sea + 5);
    for (const pylon of world.pylons()) expect(gen.heightAt(pylon.x, pylon.z)).toBeGreaterThan(sea + 1);
    expect(world.cables().every(c => c.points.length >= 2)).toBe(true);
    let trees = 0;
    for (let cz = 40; cz < 50; cz++) for (let cx = 38; cx < 48; cx++) trees += gen.generateChunk(cx, cz, 0).props.filter(p => (p.asset >= 2440 && p.asset < 2460) || (p.asset >= 2600 && p.asset <= 2611) || (p.asset >= 2626 && p.asset <= 2634)).length;
    expect(trees).toBeGreaterThan(200);
  });
  it.each([false, true])('allows climbing a tower ladder onto its actual platform (water=%s)', water => {
    const world = new CollisionWorld({ worldSize: 96, seaLevel: -10 });
    for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) world.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
    const parts: CampPart[] = [];
    battleTower(parts, 48, 48, 1, water);
    for (const [i, p] of parts.entries()) world.setOwnerColliders(i + 1, assetColliders(registry.byNumericId(p.asset)!, { x: p.x, y: p.y, z: p.z, rotY: p.yaw, scale: p.scale }));
    const controller = new CharacterController(world), state = createCharacterState(48, 0, 51.9);
    let climbed = false;
    for (let i = 0; i < 175; i++) {
      controller.step(state, { mx: 0, mz: 1, yaw: 0, jump: false, sprint: false }, TICK_DT);
      climbed ||= state.climbing;
    }
    expect(climbed).toBe(true);
    expect(state.y).toBeGreaterThanOrEqual(7.95);
    expect(state.z).toBeLessThan(51);
    expect(state.grounded).toBe(true);
  });
  it('allows a real character to climb from the ground floor to the first upper floor', () => {
    const parts: CampPart[] = [];
    modularBuilding(parts, -14, 14, 2, 4, false);
    const site = { x: 96, z: 96, y: 0, parts }, world = new CollisionWorld({ worldSize: 256, seaLevel: -20 });
    const bx = site.x - 14, bz = site.z + 14;
    const cx = Math.floor(bx / 32), cz = Math.floor(bz / 32);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) world.addChunk(cx + dx, cz + dz, new Heightfield((cx + dx) * 32, (cz + dz) * 32, 1, 33, new Float32Array(1089).fill(site.y), new Float32Array(1089).fill(NaN)), []);
    for (const [i, p] of site.parts.entries()) world.setOwnerColliders(i + 1, assetColliders(registry.byNumericId(p.asset)!, { x: site.x + p.x, y: site.y + p.y, z: site.z + p.z, rotY: p.yaw, scale: p.scale }));
    // The old side-wall openings and upper rear opening must all block sight/movement.
    const hit = makeRayHit();
    for (const side of [-1, 1]) expect(world.raycast(bx, site.y + 1.6, bz, side, 0, 0, 8, Mask.LineOfSight, hit)).toBe(true);
    expect(world.raycast(bx, site.y + 4.8, bz, 0, 0, 1, 8, Mask.LineOfSight, hit)).toBe(true);
    const frontDoor = site.parts.find(p => p.group === 4 && p.asset === BATTLE_ASSET.door && p.y < 1 && p.z < 14)!;
    const door = { x: site.x + frontDoor.x, y: site.y + frontDoor.y, z: site.z + frontDoor.z, yaw: 0, open: false };
    world.setOwnerColliders(99999, doorColliders(door));
    expect(world.raycast(bx, site.y + 1.6, bz, 0, 0, -1, 8, Mask.LineOfSight, hit)).toBe(true);
    world.setOwnerColliders(99999, doorColliders({ ...door, open: true }));
    expect(world.raycast(bx, site.y + 1.6, bz, 0, 0, -1, 8, Mask.LineOfSight, hit)).toBe(false);
    expect(site.parts.some(p => p.group === 4 && p.asset === BRIDGE_ASSET.woodenDeck && p.z < 8 && p.y > 3)).toBe(true);
    const controller = new CharacterController(world), state = createCharacterState(bx + 5, site.y + .26, bz - 4.8);
    state.grounded = true;
    for (let i = 0; i < 100; i++) controller.step(state, { mx: 0, mz: 1, yaw: Math.PI, jump: false, sprint: false }, TICK_DT);
    expect(state.y).toBeGreaterThan(site.y + 3.3);
    expect(state.z).toBeGreaterThan(bz + 3.5);
    const upstairs = createCharacterState(bx + 5, site.y + 3.46, bz - 4.8);
    upstairs.grounded = true;
    for (let i = 0; i < 100; i++) controller.step(upstairs, { mx: 0, mz: 1, yaw: Math.PI, jump: false, sprint: false }, TICK_DT);
    expect(upstairs.y).toBeGreaterThan(site.y + 6.5);
    expect(upstairs.z).toBeGreaterThan(bz + 3.5);
  });
  it('streams identical structure parts at shared chunk edges and every visible LOD', () => {
    const site = battleStructures(gen)[0]!, cx = Math.floor(site.x / 32), cz = Math.floor(site.z / 32);
    const props = [0, 1].map(lod => [-1, 0, 1].flatMap(dx => [-1, 0, 1].flatMap(dz => {
      const chunk = gen.generateChunk(cx + dx, cz + dz, lod);
      return chunk.props.filter(p => p.asset >= 2000).map(p => ({ asset: p.asset, ...propTransform(chunk, p) }));
    })));
    expect(props[0]).toEqual(props[1]);
  });
});
