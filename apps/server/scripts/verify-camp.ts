import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CAMP_ASSET, CAMP_ASSETS, assetColliders, bbCubeFaces, buildChunkCollision, createDefaultRegistry, isCubeElement, parseBBModel } from '@zion/assets';
import { CharacterController, CollisionWorld, Layer, makeBox } from '@zion/physics';
import { CHUNK_SIZE, ZombieVariant, propTransform } from '@zion/shared';
import { CAMP_LAYOUT, WorldGenerator, normalizeSeed } from '@zion/worldgen';
import { touchesBarbedWire } from '../src/game/hazards';
import { SpawnService } from '../src/game/spawn';
import type { PhysicsChunkManager } from '../src/game/physics-manager';
import { Zombie, ZombieDirector } from '../src/game/zombies';
import { CampGuardDirector } from '../src/game/camp-guards';

const registry = createDefaultRegistry();
for (const seed of ['zion-alpha', 'test-world', '12345']) for (const sizeChunks of [16, 64, 128]) {
  const gen = new WorldGenerator({ seed: normalizeSeed(seed), sizeChunks }, registry);
  assert.ok(gen.camp, `missing camp: ${seed}/${sizeChunks}`);
  const camp = gen.camp;
  for (let x = -54; x <= 54; x += 3) for (let z = -54; z <= 54; z += 3) {
    const sample = gen.sampleColumn(camp.x + x, camp.z + z);
    assert.ok(Math.abs(sample.height - camp.y) < 1e-8);
    assert.ok(!Number.isFinite(sample.water));
  }
}
const config = { seed: normalizeSeed('zion-alpha'), sizeChunks: 64 };
const gen = new WorldGenerator(config, registry);
const other = new WorldGenerator(config, registry);
assert.deepEqual(gen.camp, other.camp);
assert.equal(new WorldGenerator({ ...config, generatorVersion: 1 }, registry).camp, null);
assert.ok(gen.camp);
const camp = gen.camp;
const collision = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: gen.seaLevel });
let count = 0;
for (let cx = Math.floor((camp.x - 75) / CHUNK_SIZE); cx <= Math.floor((camp.x + 75) / CHUNK_SIZE); cx++) {
  for (let cz = Math.floor((camp.z - 75) / CHUNK_SIZE); cz <= Math.floor((camp.z + 75) / CHUNK_SIZE); cz++) {
    const c = gen.generateChunk(cx, cz, 0);
    assert.deepEqual(c, other.generateChunk(cx, cz, 0));
    assert.deepEqual(c.props, gen.generateChunk(cx, cz, 1).props);
    const col = buildChunkCollision(c, registry);
    collision.addChunk(cx, cz, col.heightfield, col.colliders);
    for (const p of c.props) {
      const t = propTransform(c, p);
      if (p.asset >= 2000) count++;
      else assert.ok(Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) >= 59.98, 'natural prop in compound');
    }
  }
}
assert.equal(count, CAMP_LAYOUT.length, 'missing or duplicated parts across chunk boundaries');
const controller = new CharacterController(collision);
const physics = { ensureArea: () => Promise.resolve() } as unknown as PhysicsChunkManager;
const spawns = new SpawnService(gen, collision, controller, physics);
const spawn = await spawns.pickSpawn();
// Spawns land somewhere on the central avenue, inside the safe zone.
assert.ok(Math.abs(spawn.x - camp.x) < 5 && spawn.z - camp.z > -17 && spawn.z - camp.z < 29, 'spawn off the avenue');
assert.ok(spawns.inSafeZone(spawn.x, spawn.z) && spawns.inSafeZone(camp.x + 49, camp.z - 49) && !spawns.inSafeZone(camp.x + 51, camp.z));
for (const [x, z] of [[0, 0], [50, 50], [-62, 0], [0, 62]]) assert.equal(spawns.allowsZombieSpawn(camp.x + x!, camp.z + z!), false);
assert.equal(spawns.allowsZombieSpawn(camp.x + 63, camp.z), true);
for (let z = 20; z <= 54; z += 0.25) assert.ok(controller.isFree(camp.x, camp.y + 0.02, camp.z + z), `blocked entrance at ${z}`);
for (const [x, z] of [[-22, -27], [23, -26], [26, 22]]) assert.ok(controller.isFree(camp.x + x!, camp.y + 0.02, camp.z + z!), 'building interior blocked');
assert.equal(touchesBarbedWire(collision, spawn), false);
const guards = new CampGuardDirector(camp, collision, { shot: () => undefined, hit: () => undefined });
guards.step([], [], 0);
assert.equal(guards.guards.length, 3);
for (const guard of guards.guards) {
  assert.ok(guard.active, 'guard post must be loaded and collision-free');
  assert.equal(touchesBarbedWire(collision, guard.state), false, 'guard touches the wire');
  assert.ok(Math.abs(guard.state.x - camp.x) >= 3, 'guard blocks the central entrance');
}

const wireWorld = new CollisionWorld({ worldSize: 256, seaLevel: 0 });
const wire = registry.byNumericId(CAMP_ASSET['barbed-wire-fence'])!;
for (const yaw of [0, Math.PI / 2, Math.PI / 4]) {
  wireWorld.setOwnerColliders(1, assetColliders(wire, { x: 64, y: 10, z: 64, rotY: yaw, scale: 1 }));
  const distance = wire.colliders[0]!.type === 'box' ? wire.colliders[0].halfExtents[2] + 0.37 : 0;
  const p = { x: 64 + Math.sin(yaw) * distance, y: 10, z: 64 + Math.cos(yaw) * distance };
  assert.equal(touchesBarbedWire(wireWorld, p), true, 'solid fence contact must hurt after depenetration');
  assert.equal(touchesBarbedWire(wireWorld, { ...p, y: 15 }), false);
  assert.equal(touchesBarbedWire(wireWorld, { x: 70, y: 10, z: 70 }), false);
}
wireWorld.setOwnerColliders(1, [{ shape: makeBox(64, 11, 64, 2, 1, 0.3), layer: Layer.Static, tag: CAMP_ASSET['iron-fence'] }]);
assert.equal(touchesBarbedWire(wireWorld, { x: 64, y: 10, z: 64.66 }), false);
wireWorld.removeOwnerColliders(1);
assert.equal(touchesBarbedWire(wireWorld, { x: 64, y: 10, z: 64.66 }), false);

const director = new ZombieDirector(collision, spawns, { attackPlayer: () => undefined });
const brute = new Zombie(1_000_000, 0, 0, 0, ZombieVariant.Brute);
const gaunt = new Zombie(1_000_001, 0, 0, 0, ZombieVariant.Gaunt);
assert.equal(brute.health, 240);
assert.equal(gaunt.health, 100);
assert.equal(director.hit(brute, 'head', 40, 0, 0, 0, 1, null).killed, false);
assert.equal(director.hit(gaunt, 'head', 40, 0, 0, 0, 1, null).killed, true);
for (const asset of CAMP_ASSETS) {
  assert.ok(asset.model.kind === 'bbmodel');
  const model = parseBBModel(JSON.parse(await readFile(new URL(`../../../models/${asset.model.path}`, import.meta.url), 'utf8')));
  for (const e of model.elements) if (isCubeElement(e)) {
    const faces = bbCubeFaces(e);
    assert.ok(Object.keys(faces).length > 0, 'box-UV cube must generate geometry');
    for (const f of Object.values(faces)) if (f && typeof f === 'object' && 'uv' in f && Array.isArray(f.uv)) assert.ok(f.uv.every(Number.isFinite));
  }
}
console.log(`Camp verified: ${CAMP_LAYOUT.length} parts, 9 seed/size combinations, flat dry foundation, clear spawn/entrance/interiors, spawn exclusion, deterministic LOD streaming, wire contact, zombie variants.`);
