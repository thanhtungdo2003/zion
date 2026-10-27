import { untexturedGlb } from './test-glb';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { AnimationMixer, Vector3, type SkinnedMesh } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { buildBBModel, mirrorCharacter, survivorTemplate, type CharacterTemplate, type RawModel } from './character-model';
import { parseHumanAssets, type HumanAssets } from './human-rig';
import { buildMixamoMotion, type MixamoMotion } from './mixamo-body';

let assets: HumanAssets;
let motion: MixamoMotion;
let template: CharacterTemplate;
let srcRestArm: Vector3;

beforeAll(async () => {
  const glb = await readFile(new URL('../../../public/models/characters/zion-survivor.glb', import.meta.url));
  assets = await parseHumanAssets(untexturedGlb(glb));
  const fbx = await readFile(new URL('../../../public/models/characters/mocap/walking.fbx', import.meta.url));
  const src = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), '');
  src.updateMatrixWorld(true);
  const p = (n: string) => src.getObjectByName(n)!.getWorldPosition(new Vector3());
  srcRestArm = p('mixamorig5LeftForeArm').sub(p('mixamorig5LeftArm')).normalize();
  const mixer = new AnimationMixer(src);
  mixer.clipAction(src.animations[0]!).play();
  motion = buildMixamoMotion(assets, src, src.animations[0]!, mixer);
  const raw = JSON.parse(await readFile(new URL('../../../../../models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  template = { ...survivorTemplate(mirrorCharacter(await buildBBModel(raw)), assets), mixamo: motion };
}, 60_000);

/** Joint positions (asset space) of one baked walk frame. */
function pose(f: number): Map<string, Vector3> {
  const { joints, rest, walk } = motion;
  const out: Vector3[] = [];
  joints.forEach((j, k) => {
    out[k] = j.parent < 0 ? rest[0]!.clone().add(walk.hips[f]!)
      : out[j.parent]!.clone().add(rest[k]!.clone().sub(rest[j.parent]!).applyQuaternion(walk.frames[f]![j.parent]!));
  });
  return new Map(joints.map((j, k) => [j.name, out[k]!]));
}

describe('Mixamo skeleton', () => {
  it('reads the recording from its T-pose and maps every survivor bone to a joint', () => {
    expect(Math.abs(srcRestArm.y)).toBeLessThan(.3);
    expect(motion.joints).toHaveLength(6 + 2 * (4 + 15 + 4));
    expect(motion.skinMap.length).toBe(assets.bones.length);
    expect(motion.skinMap[assets.index.get('forearm_L_001')!]).toBe(motion.joints.findIndex((j) => j.name === 'LeftForeArm'));
    // The face rig keeps joints of its own (the face sliders and the jaw still work).
    expect(motion.skinMap[assets.index.get('jaw')!]).toBe(motion.joints.length + motion.face.indexOf(assets.index.get('jaw')!));
    expect(motion.skinMap[assets.index.get('spine_006')!]).toBe(motion.joints.findIndex((j) => j.name === 'Head'));
  });

  it('walks upright on the survivor: feet take turns on the ground, arms hang, head on top', () => {
    const n = motion.walk.frames.length, footRest = motion.rest[motion.joints.findIndex((j) => j.name === 'LeftFoot')]!.y;
    let leftAhead = 0, rightAhead = 0, lowest = Infinity;
    for (let f = 0; f < n; f++) {
      const p = pose(f);
      lowest = Math.min(lowest, p.get('LeftFoot')!.y, p.get('RightFoot')!.y);
      const d = p.get('LeftFoot')!.z - p.get('RightFoot')!.z;
      if (d > .05) leftAhead++; if (d < -.05) rightAhead++;
      expect(p.get('Head')!.y).toBeGreaterThan(p.get('Spine2')!.y);
      for (const s of ['Left', 'Right']) expect(p.get(`${s}Hand`)!.y).toBeLessThan(p.get(`${s}Arm`)!.y);
    }
    expect(leftAhead).toBeGreaterThan(n / 5);
    expect(rightAhead).toBeGreaterThan(n / 5);
    expect(Math.abs(lowest - footRest)).toBeLessThan(.15 * footRest + .05);
    // On the spot: the loop's travel is the stride (about a leg's length), not left in the hips.
    expect(motion.walk.stride).toBeGreaterThan(motion.rest[0]!.y * .6);
    expect(Math.abs(pose(0).get('Hips')!.z - pose(Math.floor(n / 2)).get('Hips')!.z)).toBeLessThan(motion.rest[0]!.y * .1);
  });

  it('plays the walk on an avatar and stands in the survivor pose otherwise', () => {
    const avatar = new Avatar(template, true);
    const body = avatar.root.getObjectByName('survivor')!;
    const skin = body.getObjectByName('survivor-body') as SkinnedMesh;
    expect(skin.skeleton.bones[0]!.name).toBe('mixamo_Hips');
    const hand = () => body.getObjectByName('mixamo_LeftHand')!.getWorldPosition(new Vector3());
    const oldHand = () => body.getObjectByName('hand_L')!.getWorldPosition(new Vector3());
    for (let i = 0; i < 90; i++) { avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true); }
    expect(hand().distanceTo(oldHand())).toBeLessThan(.02);
    let z = 0, moved = 0;
    for (let i = 0; i < 120; i++) {
      z -= 1.4 / 60;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded, 1 / 60, 1.5 + i / 60);
      avatar.root.updateMatrixWorld(true);
      if (i > 60) moved = Math.max(moved, hand().distanceTo(oldHand()));
    }
    // Walking, the recorded arms swing on their own, not where the survivor skeleton holds them.
    expect(moved).toBeGreaterThan(.03);
  });
});
