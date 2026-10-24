import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, Group, Mesh, Scene, SkinnedMesh, Vector3 } from 'three';
import { EntityFlags, Limb, ZombieVariant } from '@zion/shared';
import { parseZombieModel, zombieTemplateIndex, ZOMBIE_MODEL_URLS } from './zombie-model';
import { untexturedGlb } from './test-glb';
import { ZombieAvatar } from './zombie-avatar';
import type { CharacterTemplate } from './character-model';

let templates: CharacterTemplate[];
beforeAll(async () => {
  templates = await Promise.all(ZOMBIE_MODEL_URLS.map(async url => {
    const bytes = await readFile(`models${url.slice('/models'.length)}`);
    return parseZombieModel(untexturedGlb(bytes));
  }));
}, 60_000);
function avatar(index: number) {
  const variant = index === 10 ? ZombieVariant.Brute : index === 11 ? ZombieVariant.Crimson : ZombieVariant.Rotting;
  const z = new ZombieAvatar(templates[index]!, vi.fn(), index === 10 ? 1.5 : 1, variant);
  z.ground = () => 0; z.seen = true;
  z.update(0, 0, 0, 0, EntityFlags.Grounded, 0, .1);
  return z;
}
describe('supplied zombie models', () => {
  it('assigns all ten human skins stably and keeps hunter/dog on their gameplay kinds', () => {
    const used = new Set<number>();
    for (let id = 1_000_000; id < 1_000_500; id++) {
      used.add(zombieTemplateIndex(ZombieVariant.Rotting, id));
      expect(zombieTemplateIndex(ZombieVariant.Gaunt, id)).toBe(zombieTemplateIndex(ZombieVariant.Rotting, id));
      expect(zombieTemplateIndex(ZombieVariant.Brute, id)).toBe(10);
      expect(zombieTemplateIndex(ZombieVariant.Crimson, id)).toBe(11);
    }
    expect(used.size).toBe(10);
  });
  it.each(Array.from({ length: 12 }, (_, i) => i))('model %s has one creature, grounded geometry, independent skin and immediate locomotion', index => {
    const a = avatar(index), b = avatar(index);
    const skin = (z: ZombieAvatar) => z.root.getObjectsByProperty('isSkinnedMesh', true) as SkinnedMesh[];
    const mesh = skin(a)[0]!, other = skin(b)[0]!;
    expect(mesh.skeleton.bones[0]).not.toBe(other.skeleton.bones[0]);
    expect(mesh.geometry).toBe(other.geometry);
    expect(Math.abs(new Box3().setFromObject(a.root, true).min.y)).toBeLessThan(.015);
    expect(templates[index]!.zombie!.animations).toHaveLength(0);
    const height = new Box3().setFromObject(a.root, true).getSize(new Vector3()).y;
    expect(height).toBeGreaterThan(index === 11 ? .8 : 1.6); expect(height).toBeLessThan(index === 10 ? 3 : 2.1);
    const q = mesh.skeleton.bones.map(bone => bone.quaternion.clone());
    a.update(0, 0, -.06, 0, EntityFlags.Grounded, 0, 1 / 60);
    expect(mesh.skeleton.bones.some((bone, i) => bone.quaternion.angleTo(q[i]!) > 1e-4)).toBe(true);
    for (const bone of mesh.skeleton.bones) expect(bone.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    a.dispose(new Scene()); b.dispose(new Scene());
  });
  it.each(Array.from({ length: 12 }, (_, i) => i))('model %s moves its actual legs and torso while attacking, without stretching', index => {
    const z = avatar(index), aliases = templates[index]!.zombie!.aliases;
    const joint = (role: string) => z.root.getObjectByName(aliases[role]!)!;
    const roles = ['hips', 'body', 'leg_left', 'shin_left', 'foot_left', 'leg_right', 'shin_right', 'foot_right'];
    for (const role of roles) expect(joint(role), role).toBeDefined();
    const initial = roles.map(role => joint(role).quaternion.clone());
    const lengths = ['left', 'right'].map(side => {
      const p = (role: string) => joint(`${role}_${side}`).getWorldPosition(new Vector3());
      return [p('leg').distanceTo(p('shin')), p('shin').distanceTo(p('foot'))];
    });
    const changed = new Set<string>();
    for (let frame = 1; frame <= 90; frame++) {
      z.update(0, 0, -frame * .07, 0, EntityFlags.Grounded | EntityFlags.Attacking, 0, 1 / 60);
      z.root.updateMatrixWorld(true);
      roles.forEach((role, i) => { if (joint(role).quaternion.angleTo(initial[i]!) > .01) changed.add(role); });
      ['left', 'right'].forEach((side, i) => {
        const p = (role: string) => joint(`${role}_${side}`).getWorldPosition(new Vector3());
        expect(p('leg').distanceTo(p('shin'))).toBeCloseTo(lengths[i]![0]!, 5);
        expect(p('shin').distanceTo(p('foot'))).toBeCloseTo(lengths[i]![1]!, 5);
      });
    }
    for (const role of ['body', 'leg_left', 'shin_left', 'leg_right', 'shin_right']) expect(changed.has(role), role).toBe(true);
    z.dispose(new Scene());
  });
  it('keeps gait timing close at 30 and 60 fps and resumes after a teleport', () => {
    const a = avatar(2), b = avatar(2), aliases = templates[2]!.zombie!.aliases;
    for (const [z, fps] of [[a, 30], [b, 60]] as const) {
      for (let frame = 1; frame <= fps * 2; frame++) z.update(0, 0, -frame * 3 / fps, 0, EntityFlags.Grounded, 0, 1 / fps);
    }
    const foot = (z: ZombieAvatar) => z.root.worldToLocal(z.root.getObjectByName(aliases.foot_left!)!.getWorldPosition(new Vector3()));
    expect(foot(a).distanceTo(foot(b))).toBeLessThan(.05);
    a.update(50, 0, 50, 0, EntityFlags.Grounded, 0, 1 / 60);
    for (let frame = 1; frame < 30; frame++) a.update(50, 0, 50 - frame * .05, 0, EntityFlags.Grounded, Limb.ArmL, 1 / 60);
    expect(foot(a).length()).toBeLessThan(2);
    a.root.traverse(node => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  });
  it('refuses buckets on the dog, including stale equipment snapshots', () => {
    const z = avatar(11), count = z.root.children.length;
    const bucket = new Group(); bucket.name = 'test-dog-bucket';
    z.setBucket(bucket);
    expect(z.root.getObjectByName('test-dog-bucket')).toBeUndefined();
    expect(z.root.children).toHaveLength(count);
  });
  it('dog leaps in its quadrupedal rig and carries the pose into a stable ragdoll', () => {
    const z = avatar(11);
    z.update(0, .8, -.5, .4, EntityFlags.Leaping, 0, .1);
    expect(new Vector3(0, 1, 0).applyQuaternion(z.root.children[0]!.quaternion).y).toBeCloseTo(1);
    const model = z.root.children[0]!;
    const head = model.getObjectByName('head')!;
    const before = head.getWorldPosition(new Vector3());
    const ragdoll = z.startRagdoll(0, -1, 3, () => 0);
    expect(ragdoll).not.toBeNull();
    for (let i = 0; i < 330; i++) z.update(50, 20, 50, 2, EntityFlags.Attacking, 0, 1 / 60);
    expect(z.root.position.toArray()).toEqual([0, .8, -.5]);
    expect(head.getWorldPosition(new Vector3()).y).toBeLessThan(before.y);
    z.root.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  });
  it('removes skinned lower limbs and bakes one detached head without affecting another zombie', () => {
    const a = avatar(0), b = avatar(0);
    a.update(0, 0, 0, 0, EntityFlags.Grounded, Limb.ArmL | Limb.LegR | Limb.Head, .1);
    const pieces = (z: ZombieAvatar, zone: string) => z.root.getObjectsByProperty('isSkinnedMesh', true).filter(o => o.userData.zombieZone === zone);
    for (const zone of ['head', 'forearm_left', 'shin_right']) {
      expect(pieces(a, zone).length).toBeGreaterThan(0);
      expect(pieces(a, zone).every(o => !o.visible)).toBe(true);
      expect(pieces(b, zone).every(o => o.visible)).toBe(true);
    }
    expect(a.root.children.some(o => o.children.some(c => c instanceof Mesh && !(c instanceof SkinnedMesh)))).toBe(true);
  });
});
