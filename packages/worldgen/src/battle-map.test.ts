import { describe, expect, it } from 'vitest';
import { assetColliders, createDefaultRegistry, BATTLE_ASSET, BRIDGE_ASSET } from '@zion/assets';
import { BATTLE_MAP, CHEST_ASSETS, propTransform, TICK_DT } from '@zion/shared';
import { CharacterController, CollisionWorld, Heightfield, createCharacterState, doorColliders, Mask, makeRayHit } from '../../physics/src/index';
import { WorldGenerator } from './generator';
import { normalizeSeed } from './config';
import { battleStructures, battleTerrain, battleTower } from './battle-map';
import type { CampPart } from './camp';

const registry = createDefaultRegistry();
const config = { seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale' as const };
const gen = new WorldGenerator(config, registry);
describe('first seeded Battle Royale map', () => {
  it('is deterministic, has no safe camp, and provides dry towns, construction sites and upstairs crates', () => {
    const sites = battleStructures(gen), copy = new WorldGenerator(config, registry);
    expect(gen.camp).toBeNull(); expect(gen.roads!.connectedSites.length).toBeGreaterThanOrEqual(140);
    expect(battleStructures(copy)).toEqual(sites);
    expect(sites).toHaveLength(150);
    expect(sites.some(s => s.kind === 'factory')).toBe(true);
    for (const site of sites) {
      expect(site.y).toBeGreaterThan(gen.seaLevel + 5);
      expect(gen.heightAt(site.x, site.z)).toBeCloseTo(site.y);
      expect(site.parts.some(p => CHEST_ASSETS.has(p.asset))).toBe(true);
      if (site.kind === 'town') {
        expect(site.parts.some(p => CHEST_ASSETS.has(p.asset) && p.y > 3)).toBe(true);
        expect(new Set(site.parts.filter(p => p.asset === BATTLE_ASSET.door).map(p => p.group)).size).toBeGreaterThanOrEqual(12);
        expect(site.parts.some(p => p.asset === 2421)).toBe(true);
        expect(site.parts.filter(p => p.asset === BATTLE_ASSET.street).length).toBeGreaterThan(100);
        const tiles = site.parts.filter(p => p.asset === BATTLE_ASSET.street);
        expect(new Set(tiles.map(p => `${p.x}:${p.z}`)).size).toBe(tiles.length);
        for (const a of tiles) for (const b of tiles) if (a !== b) expect(Math.abs(a.x-b.x) >= 8 || Math.abs(a.z-b.z) >= 8).toBe(true);
        expect(site.parts.some(p => p.asset === BATTLE_ASSET.balconyPost)).toBe(true);
      }
      for (const part of site.parts) expect(registry.byNumericId(part.asset)).toBeDefined();
    }
    expect(gen.findSpawnPoints(96, 65).length).toBeGreaterThanOrEqual(32);
    const s = sites[0]!, cx = Math.floor(s.x / 32), cz = Math.floor(s.z / 32);
    expect(gen.generateChunk(cx, cz, 0)).toEqual(copy.generateChunk(cx, cz, 0));
  });
  it('has an irregular island coastline, dry foundations and clustered settlements', () => {
    const size = gen.worldSize, sea = gen.seaLevel, sites = battleStructures(gen);
    for (let t = 0; t <= size; t += 128) for (const [x, z] of [[0, t], [size, t], [t, 0], [t, size]]) expect(battleTerrain(gen.seed, size, sea, x!, z!)).toBeLessThan(sea);
    const shores: number[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      let distance = 0;
      while (battleTerrain(gen.seed, size, sea, size / 2 + Math.cos(angle) * distance, size / 2 + Math.sin(angle) * distance) > sea && distance < size / 2) distance += 16;
      shores.push(distance);
    }
    expect(Math.max(...shores) - Math.min(...shores)).toBeGreaterThan(200);
    expect(sites.filter(s => s.kind === 'farm')).toHaveLength(24);
    expect(sites.filter(s => s.kind === 'hamlet')).toHaveLength(28);
    const nearest = sites.map(s => Math.min(...sites.filter(other => other !== s).map(other => Math.hypot(other.x - s.x, other.z - s.z))));
    expect(nearest.reduce((sum, d) => sum + d, 0) / nearest.length).toBeLessThan(220);
    for (const site of sites) for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      expect(battleTerrain(gen.seed, size, sea, site.x + Math.cos(angle) * (site.radius + 24), site.z + Math.sin(angle) * (site.radius + 24))).toBeGreaterThan(sea + 7);
    }
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
    const site = battleStructures(gen).find(s => s.kind === 'factory')!, world = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: 20 });
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
