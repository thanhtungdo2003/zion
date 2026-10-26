import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ROAD_ASSET, SIGN_ASSET, createDefaultRegistry } from '@zion/assets';
import { VEHICLES, createVehicleMotion, quantizeHeight, quantizeLocal, type BodiesMessage, type VehicleState } from '@zion/shared';
import { CollisionWorld, DYNAMIC_BODY_TAG, Heightfield, JoltVehicles, Layer, Mask, dynamicBodyOwner, loadJolt, makeRayHit, poseTransform } from '@zion/physics';
import { FreeBodies } from './free-bodies';
import { PropKnock, RESTORE_MS } from './prop-knock';

/** Small, bounded scenes: one or two bodies, a few simulated seconds, no rendering. */
beforeAll(() => loadJolt());

function ground() {
  const w = new CollisionWorld({ worldSize: 96, seaLevel: -10 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
  }
  return w;
}

function scene(asset: number, at = 10) {
  const world = ground(), sim = new JoltVehicles(world), bodies = new FreeBodies(() => sim, world);
  const chunk = { cx: 0, cz: 0, props: [{ asset, lx: quantizeLocal(at), lz: quantizeLocal(at), yq: quantizeHeight(0), rot: 0, scale: 100 }] };
  const sent: Array<{ t: string; body?: number; keys?: string[] }> = [];
  const knock = new PropKnock({
    world: { peek: (cx: number, cz: number) => (cx === 0 && cz === 0 ? { data: chunk } : undefined) } as never,
    registry: createDefaultRegistry(), physics: { propFilter: null, reload: vi.fn() } as never, bodies,
    broadcastAt: (_x, _z, m) => sent.push(m), broadcast: (m) => sent.push(m), occupied: () => false,
  });
  const received: BodiesMessage[] = [];
  const viewer = { x: at, z: at, send: (text: string) => received.push(JSON.parse(text) as BodiesMessage) };
  let tick = 0;
  const run = (seconds: number, walkers: Array<{ x: number; y: number; z: number; vx: number; vz: number }> = [], vehicles: VehicleState[] = []) => {
    for (let i = 0; i < Math.round(seconds * 30); i++, tick++) {
      bodies.push(walkers, 1 / 30);
      for (const w of walkers) { w.x += w.vx / 30; w.z += w.vz / 30; }
      sim.step(vehicles, (v) => (v.driver ? { throttle: 1, steer: 0 } : undefined), 1 / 30, tick * 1000 / 30);
      bodies.sync(tick * 1000 / 30, tick % 2 === 0, [viewer]);
    }
  };
  return { world, sim, bodies, knock, sent, received, run, dispose: () => sim.dispose() };
}

describe('knocked props as server rigid bodies', () => {
  it('a round knocks a road sign loose: it topples, lies on the ground, stands in the collision world and goes quiet', () => {
    const s = scene(SIGN_ASSET.stop);
    try {
      s.knock.bullet(SIGN_ASSET.stop, 10, 2.5, 10, 0, 0, -1, 30, 0);
      const id = s.sent[0]!.body!;
      expect(id).toBeGreaterThan(0);
      // Shot high on the plate: the sign tips over and comes to rest on the ground.
      s.run(4);
      const pose = s.bodies.pose(id)!, top = poseTransform(pose, 0, 2.55, 0);
      expect(top[1]).toBeLessThan(.6);
      expect(s.sim.bodyState(id)!.awake).toBe(false);
      // Shots meet it where it lies (layer Dynamic, its own tag), walking does not.
      const hit = makeRayHit();
      expect(s.world.raycast(top[0], 3, top[2], 0, -1, 0, 5, Mask.Weapon, hit)).toBe(true);
      expect(hit.tag).toBe(DYNAMIC_BODY_TAG + id);
      expect(hit.layer).toBe(Layer.Dynamic);
      // Poses went out while it moved, the last one asleep, then nothing more.
      const rows = s.received.flatMap((m) => m.list.filter((r) => r[0] === id));
      expect(rows.length).toBeGreaterThan(5);
      expect(rows.at(-1)![10]).toBe(1);
      const count = s.received.length;
      s.run(1);
      expect(s.received.length).toBe(count);
    } finally { s.dispose(); }
  });

  it('a walker knocks over and shoves a cone and a drum out of the way', () => {
    const moved: number[] = [], kick: number[] = [];
    for (const asset of [ROAD_ASSET.cone, 2660]) {
      const s = scene(asset);
      try {
        // A blast far off knocks it loose without moving it much; then someone walks into it.
        s.knock.blast(10, 0, 30, 2, 0);
        s.knock.bullet(asset, 10, .4, 10, 0, 0, -1, 1, 0);
        const id = s.sent.find((m) => m.t === 'knock')!.body!;
        s.run(1.5);
        const start = s.bodies.pose(id)!;
        // Contact comes after about 0.2 s; the shove is the body's speed just after it.
        const walker = { x: start.x, y: 0, z: start.z + 1.2, vx: 0, vz: -3 };
        s.run(.35, [walker]);
        const v = s.sim.bodyState(id)!.v;
        kick.push(Math.hypot(v[0], v[2]));
        s.run(1.65, [walker]);
        const end = s.bodies.pose(id)!;
        moved.push(start.z - end.z);
      } finally { s.dispose(); }
    }
    // Pushed at hip height, both tip and give way (the drum then rolls on its side).
    for (const k of kick) expect(k).toBeGreaterThan(.2);
    for (const m of moved) expect(m).toBeGreaterThan(.5);
  });

  it('a car shoves a drum ahead of it by mass, barely slowing', () => {
    const s = scene(2660, 20);
    const car: VehicleState = { id: 1, kind: 'car', x: 20, y: 0, z: 42, yaw: 0, speed: 0, health: VEHICLES.car.health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion('car') };
    try {
      s.sim.add(car);
      s.knock.bullet(2660, 20, .5, 20, 0, 0, -1, 1, 0);
      const id = s.sent[0]!.body!;
      s.run(4, [], [car]);
      const drum = s.bodies.pose(id)!;
      expect(drum.z).toBeLessThan(16);
      expect(car.speed).toBeGreaterThan(6);
    } finally { s.dispose(); }
  });

  it('standing again removes the body and its colliders, and tells the viewers', () => {
    const s = scene(SIGN_ASSET.stop);
    try {
      s.knock.bullet(SIGN_ASSET.stop, 10, 2.5, 10, 0, 0, -1, 30, 0);
      const id = s.sent[0]!.body!;
      s.run(.5);
      s.knock.step(RESTORE_MS + 1);
      s.run(.1);
      expect(s.bodies.has(id)).toBe(false);
      expect(s.sim.hasBody(id)).toBe(false);
      expect(s.world.queryAABB({ minX: 0, minY: -5, minZ: 0, maxX: 30, maxY: 5, maxZ: 30 }, Layer.Dynamic, [])).toBe(0);
      expect(s.received.some((m) => m.gone?.includes(id))).toBe(true);
      expect(dynamicBodyOwner(id)).toBeGreaterThan(0);
    } finally { s.dispose(); }
  });
});
