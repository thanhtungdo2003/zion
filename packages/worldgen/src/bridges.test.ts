import { beforeAll, describe, expect, it } from 'vitest';
import { BRIDGE_ASSET, VEHICLE_ASSET, CAMP_ASSET, assetColliders, createDefaultRegistry } from '@zion/assets';
import { Mask, CollisionWorld, makeRayHit } from '../../physics/src/index';
import { propTransform } from '@zion/shared';
import { WorldGenerator, makeColumnSample } from './generator';
import { normalizeSeed } from './config';

describe('bridge road network', () => {
  const registry = createDefaultRegistry();
  let gen: WorldGenerator;
  beforeAll(() => { gen = new WorldGenerator({ seed: normalizeSeed('zion-alpha'), sizeChunks: 128 }, registry); });

  it('has alternate routes, large crossings and multiple small bridge materials', () => {
    const roads = gen.roads!;
    expect(roads.loopCount).toBeGreaterThan(5);
    expect(roads.bridges.length).toBeGreaterThan(5);
    expect(roads.bridges.some(b => b.kind === 'large' && b.length >= 48)).toBe(true);
    expect(new Set(roads.bridges.filter(b => b.kind !== 'large').map(b => b.kind)).size).toBeGreaterThan(1);
    // A connected undirected graph with E >= V has a cycle.
    const points = new Set(roads.segments.flatMap(s => [s.a, s.b]));
    expect(roads.segments.length).toBeGreaterThanOrEqual(points.size);
  });

  it('preserves water and riverbeds below level decks and keeps enough clearance', () => {
    const sample = makeColumnSample(), raw = makeColumnSample();
    for (const bridge of gen.roads!.bridges) {
      expect(bridge.a.y).toBeCloseTo(bridge.b.y, 6);
      for (let d = 1; d < bridge.length; d += 3) {
        const t = d / bridge.length, x = bridge.a.x + (bridge.b.x - bridge.a.x) * t, z = bridge.a.z + (bridge.b.z - bridge.a.z) * t;
        gen.rawTerrain = true;
        try { gen.sampleColumn(x, z, raw); } finally { gen.rawTerrain = false; }
        gen.sampleColumn(x, z, sample);
        expect(sample.roadBridge).toBe(true);
        if (sample.roadBridgeEnd >= 4 || raw.height <= (Number.isFinite(raw.water) ? raw.water : gen.seaLevel) + .15) expect(sample.height).toBeCloseTo(raw.height, 5);
        expect(sample.water).toBe(raw.water);
        const water = Number.isFinite(raw.water) ? raw.water : gen.seaLevel;
        if (raw.height < water + .15) expect(bridge.a.y - water).toBeGreaterThanOrEqual((bridge.kind === 'large' ? 5 : 1.5) - .01);
      }
    }
  });

  it('keeps separate crossings and their refuge bays from intersecting', () => {
    const bridges = gen.roads!.bridges;
    for (let i = 0; i < bridges.length; i++) for (let j = i + 1; j < bridges.length; j++) {
      const a = bridges[i]!, b = bridges[j]!;
      const gap = a.halfWidth + (a.bay ? 8 : 0) + b.halfWidth + (b.bay ? 8 : 0);
      const overlapX = Math.min(a.a.x, a.b.x) < Math.max(b.a.x, b.b.x) + gap && Math.max(a.a.x, a.b.x) > Math.min(b.a.x, b.b.x) - gap;
      const overlapZ = Math.min(a.a.z, a.b.z) < Math.max(b.a.z, b.b.z) + gap && Math.max(a.a.z, a.b.z) > Math.min(b.a.z, b.b.z) - gap;
      expect(overlapX && overlapZ, JSON.stringify({ a, b })).toBe(false);
    }
  });

  it('streams continuous collision decks across chunk boundaries and leaves traffic lanes clear', () => {
    const selected = (['large', 'wood', 'stone', 'asphalt'] as const).map(kind => gen.roads!.bridges.find(b => b.kind === kind)!);
    const bay = gen.roads!.bridges.find(b => b.bay)!;
    expect(bay).toBeDefined(); selected.push(bay);
    for (const bridge of selected) {
      const kind = bridge.kind;
      const world = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: gen.seaLevel });
      const minX = Math.floor((Math.min(bridge.a.x, bridge.b.x) - 12) / 32), maxX = Math.floor((Math.max(bridge.a.x, bridge.b.x) + 12) / 32);
      const minZ = Math.floor((Math.min(bridge.a.z, bridge.b.z) - 12) / 32), maxZ = Math.floor((Math.max(bridge.a.z, bridge.b.z) + 12) / 32);
      let owner = 1;
      for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
        for (const prop of gen.roads!.chunkProps(cx, cz)) {
          const def = registry.byNumericId(prop.asset)!;
          world.setOwnerColliders(owner++, assetColliders(def, propTransform({ cx, cz }, prop)));
        }
      }
      const hit = makeRayHit();
      const ux = (bridge.b.x - bridge.a.x) / bridge.length, uz = (bridge.b.z - bridge.a.z) / bridge.length;
      for (let d = .1; d < bridge.length; d += .9) for (const across of [0, -bridge.clearHalfWidth + .4, bridge.clearHalfWidth - .4]) {
        const x = bridge.a.x + ux * d - uz * across, z = bridge.a.z + uz * d + ux * across;
        expect(world.raycast(x, bridge.a.y + .3, z, 0, -1, 0, .6, Mask.CharacterMovement, hit), JSON.stringify({ kind, x, z, d, across, bridge })).toBe(true);
        expect(hit.y).toBeCloseTo(bridge.a.y, 2);
        expect(world.overlapsCapsule(x, bridge.a.y + .45, z, x, bridge.a.y + 1.8, z, .35, Mask.CharacterMovement)).toBe(false);
      }
    }
  });

  it('places real vehicle models in refuges and keeps tanks at full size', () => {
    const ids = new Set<number>();
    for (const bridge of gen.roads!.bridges.filter(b => b.kind === 'large')) {
      const cx = Math.floor((bridge.a.x + bridge.b.x) / 2 / 32), cz = Math.floor((bridge.a.z + bridge.b.z) / 2 / 32);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const p of gen.roads!.chunkProps(cx + dx, cz + dz)) {
        ids.add(p.asset);
        if (p.asset === CAMP_ASSET['old-rusty-tank']) expect(propTransform({ cx: cx + dx, cz: cz + dz }, p).scale).toBe(1);
      }
    }
    expect(ids.has(VEHICLE_ASSET.motorcycle)).toBe(true);
    expect(ids.has(VEHICLE_ASSET.car)).toBe(true);
    expect(ids.has(VEHICLE_ASSET.bus)).toBe(true);
    expect(ids.has(CAMP_ASSET['old-rusty-tank'])).toBe(true);
  });

  it('retains v3 roads without bridges or loops when explicitly requested', () => {
    const legacy = new WorldGenerator({ seed: gen.seed, sizeChunks: 64, generatorVersion: 3 }, registry);
    expect(legacy.roads!.bridges).toHaveLength(0);
    expect(legacy.roads!.loopCount).toBe(0);
    expect(registry.byNumericId(BRIDGE_ASSET.moss2)).toBeDefined();
  });
});
