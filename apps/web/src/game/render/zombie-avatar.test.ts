import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Scene, Vector3 } from 'three';
import { EntityFlags, Limb, zombieScale, type ZombieVariant } from '@zion/shared';
import { buildBBModel, type RawModel } from './character-model';
import { ZombieAvatar } from './zombie-avatar';

const variants = ['hunched-rotting-zombie', 'gaunt-zombie', 'brute-zombie', 'crimson-eyed-zombie'];
afterEach(() => vi.restoreAllMocks());

async function avatar(variant = 0) {
  const raw = JSON.parse(await readFile(new URL(`../../../../../models/mobs/${variants[variant]}.bbmodel`, import.meta.url), 'utf8')) as RawModel;
  raw.textures = []; // Exercise real geometry and animations without a browser image decoder.
  const template = await buildBBModel(raw);
  const zombie = new ZombieAvatar(template, vi.fn(), zombieScale(variant as ZombieVariant), variant as ZombieVariant);
  zombie.ground = () => 0;
  zombie.seen = true;
  zombie.update(10, 0, 10, 0.4, EntityFlags.Attacking, 0, 0.1);
  return zombie;
}

describe('zombie death ragdolls', () => {
  it.each([0, 1, 2, 3])('variant %s loses its head once, falls to terrain and removes the detached model with the corpse', async variant => {
    const zombie = await avatar(variant), scene = new Scene();
    zombie.addTo(scene);
    const head = zombie.root.getObjectByName('head')!;
    zombie.severHead(1, 0, 4);
    const detached = zombie.root.getObjectByName('detached-zombie-head')!;
    const before = new Box3().setFromObject(detached).getCenter(new Vector3());
    expect(head.visible).toBe(false);
    zombie.severHead(1, 0, 4);
    expect(zombie.root.getObjectsByProperty('name', 'detached-zombie-head')).toHaveLength(1);
    zombie.startRagdoll(1, 0, 4, () => 0);
    for (let i = 0; i < 420; i++) zombie.update(20, 0, 20, 0, EntityFlags.Dead, Limb.Head, 1 / 60);
    const after = detached.getWorldPosition(new Vector3());
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    expect(after.y).toBeCloseTo(.18 * zombieScale(variant as ZombieVariant), 2);
    expect(head.visible).toBe(false);
    zombie.dispose(scene);
    expect(scene.children).toHaveLength(0);
    expect(detached.parent).toBeNull();
  });
  it('restores headless corpses from snapshot data without the original hit event', async () => {
    const zombie = await avatar(2);
    zombie.update(10, 0, 10, 0, EntityFlags.Dead, Limb.Head, .1);
    expect(zombie.root.getObjectByName('head')!.visible).toBe(false);
    expect(zombie.root.getObjectByName('detached-zombie-head')).toBeDefined();
    zombie.update(10, 0, 10, 0, EntityFlags.Dead, Limb.Head, .1);
    expect(zombie.root.getObjectsByProperty('name', 'detached-zombie-head')).toHaveLength(1);
  });
  it('switches the brute to run_roar strictly below half health', async () => {
    const zombie = await avatar(2);
    const clip = () => (zombie as unknown as { cur: { clip: { name: string } } }).cur.clip.name;
    zombie.update(10, 0, 10, 0, EntityFlags.Grounded, 0, 2, 50);
    zombie.update(10.1, 0, 10, 0, EntityFlags.Grounded, 0, .1, 50);
    expect(clip()).toBe('walk');
    zombie.update(10.5, 0, 10, 0, EntityFlags.Grounded, 0, .1, 49);
    expect(clip()).toBe('run_roar');
  });

  it('uses the crimson crawl and leap clips without rotating the authored crawl pose twice', async () => {
    const zombie = await avatar(3);
    const clip = () => (zombie as unknown as { cur: { clip: { name: string } } }).cur.clip.name;
    zombie.update(10.5, 0, 10, 0, EntityFlags.Grounded, 0, 2);
    zombie.update(10.6, 0, 10, 0, EntityFlags.Grounded, 0, .1);
    expect(clip()).toBe('crawl_scream');
    expect(zombie.root.children[0]!.rotation.x).toBeCloseTo(0);
    zombie.update(11, 1, 10, 0, EntityFlags.Leaping, 0, .1);
    expect(clip()).toBe('crouch_spring');
  });
  for (let variant = 0; variant < variants.length; variant++) it(`${variants[variant]} goes limp, stays intact and settles`, async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const zombie = await avatar(variant);
    const body = zombie.root.getObjectByName('body')!;
    const head = zombie.root.getObjectByName('head')!;
    const before = body.getWorldPosition(new Vector3());
    const meshCount = zombie.root.getObjectsByProperty('isMesh', true).length;
    zombie.startRagdoll(1, 0, 3, () => 0);
    // Old living snapshots must not restart animation or move the corpse's root.
    for (let i = 0; i < 360; i++) zombie.update(50, 0, 50, 2, EntityFlags.Attacking, 0, 1 / 60);
    const after = body.getWorldPosition(new Vector3());
    expect(body.matrixAutoUpdate).toBe(false);
    expect(zombie.root.position.toArray()).toEqual([10, 0, 10]);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    expect(zombie.root.visible).toBe(true);
    expect(zombie.root.getObjectsByProperty('isMesh', true)).toHaveLength(meshCount);
    expect(head.getWorldPosition(new Vector3()).distanceTo(after)).toBeLessThan(2);
    zombie.root.traverse((node) => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    const settled = body.matrixWorld.clone();
    zombie.update(100, 0, 100, 0, EntityFlags.Dead, 0, 1);
    expect(body.matrixWorld.equals(settled)).toBe(true);
  });

  it('starts from a dead snapshot when the killing event was not received', async () => {
    const zombie = await avatar();
    zombie.update(10, 0, 10, 0, EntityFlags.Dead, 0, 1 / 60);
    expect(zombie.root.getObjectByName('body')!.matrixAutoUpdate).toBe(false);
  });

  it('starts only once and follows terrain height while falling', async () => {
    const zombie = await avatar();
    const ground = vi.fn((x: number) => (x - 10) * 0.1);
    zombie.startRagdoll(1, 0, 2, ground);
    zombie.update(10, 0, 10, 0, EntityFlags.Dead, 0, 1 / 60);
    const body = zombie.root.getObjectByName('body')!;
    const pose = body.matrixWorld.clone();
    zombie.startRagdoll(-1, 0, 100, ground);
    expect(body.matrixWorld.equals(pose)).toBe(true);
    for (let i = 0; i < 300; i++) zombie.update(10, 0, 10, 0, EntityFlags.Dead, 0, 1 / 60);
    expect(ground).toHaveBeenCalled();
    const p = body.getWorldPosition(new Vector3());
    expect(p.y).toBeGreaterThanOrEqual(ground(p.x) - 0.01);
  });

  it('supports death while crawling and keeps severed limbs hidden', async () => {
    const zombie = await avatar();
    const limbs = Limb.LegL | Limb.LegR;
    zombie.update(10, 0, 10, 0, 0, limbs, 0.2);
    zombie.startRagdoll(0, 1, 2, () => 0);
    for (let i = 0; i < 300; i++) zombie.update(10, 0, 10, 0, EntityFlags.Dead, limbs, 1 / 60);
    expect(zombie.root.getObjectByName('body')!.matrixAutoUpdate).toBe(false);
    expect(zombie.root.getObjectByName('shin_left')!.visible).toBe(false);
    expect(zombie.root.getObjectByName('shin_right')!.visible).toBe(false);
    zombie.root.traverse((node) => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  });
});
