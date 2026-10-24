// Ordinary zombies' motion-capture clips (Mixamo FBX in models/mobs/mocap/) → models/mobs/zombie-anims.json.
// The ten zombie skins share one 3ds Max biped skeleton but differ in proportions, so the clips are
// stored skeleton-free and retargeted when a zombie is built (render/zombie-clips.ts):
//   - per bone role and frame, the source bone's world turn from its rest (G = world · rest⁻¹),
//     in the game's frame (the character faces −Z; Mixamo faces +Z);
//   - each role's rest direction (towards its child), to line the zombie's rest pose up with it;
//   - the hips' height as a fraction of the hip height, and the ground one loop covers (stride, in
//     hip heights): the game plays a loop once per that distance, so feet do not slide.
// Usage (repo root): node apps/web/scripts/prepare-zombie-anims.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

// FBXLoader turns embedded textures into blob URLs; textures are not needed here.
globalThis.window = { URL: { createObjectURL: () => '' } };
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const root = path.resolve(import.meta.dirname, '../../..');
const dir = path.join(root, 'models/mobs/mocap');
const CLIPS = { walk: { file: 'zombie-walk.fbx', loop: true }, run: { file: 'zombie-run.fbx', loop: true }, scream: { file: 'zombie-scream.fbx', loop: false } };
/** Mixamo bone → role (the biped bone it drives, see zombie-clips.ts). */
const ROLES = {
  Hips: 'pelvis', Spine: 'spine', Spine2: 'spine1', Neck: 'neck', Head: 'head',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'forearm_l', LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'forearm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'toe_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'toe_r',
};
/** The child each direction is measured to. */
const CHILD = { Hips: 'Spine', Spine: 'Spine1', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: 'LeftToe_End',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase', RightToeBase: 'RightToe_End' };
const clean = (n) => n.replace(/^.*:/, '').replace(/^mixamorig\d*_?/i, '');
const worldQ = (o) => { const p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3(); o.matrixWorld.decompose(p, r, s); return r; };
const worldP = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
// Mixamo faces +Z, the game's characters −Z: half a turn about Y.
const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), flipInv = flip.clone().invert();
const r4 = (v) => +v.toFixed(4);

const out = { version: 1, clips: {}, restDir: {} };
for (const [id, spec] of Object.entries(CLIPS)) {
  const data = readFileSync(path.join(dir, spec.file));
  const src = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  const clip = src.animations[0], bones = new Map();
  src.traverse((o) => { if (o.isBone) bones.set(clean(o.name), o); });
  src.updateMatrixWorld(true);
  const rest = new Map([...bones].map(([n, b]) => [n, worldQ(b)]));
  const hipsRest = worldP(bones.get('Hips'));
  const footY = Math.min(...['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((n) => worldP(bones.get(n)).y));
  const hipH = hipsRest.y - footY;
  if (!Object.keys(out.restDir).length) for (const [m, role] of Object.entries(ROLES)) {
    const b = bones.get(m), c = bones.get(CHILD[m]);
    if (b && c) out.restDir[role] = worldP(c).sub(worldP(b)).normalize().applyQuaternion(flip).toArray().map(r4);
  }
  const mixer = new THREE.AnimationMixer(src), action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const frames = Math.max(2, Math.round(clip.duration * 30) + 1), tracks = {}, hipsY = [], travel = [];
  for (const role of Object.values(ROLES)) tracks[role] = [];
  for (let f = 0; f < frames; f++) {
    mixer.setTime(clip.duration * f / (frames - 1)); src.updateMatrixWorld(true);
    for (const [m, role] of Object.entries(ROLES)) {
      const b = bones.get(m);
      if (!b) continue;
      const g = flip.clone().multiply(worldQ(b).multiply(rest.get(m).clone().invert())).multiply(flipInv).normalize();
      const prev = tracks[role].slice(-4);
      if (prev.length && g.x * prev[0] + g.y * prev[1] + g.z * prev[2] + g.w * prev[3] < 0) g.set(-g.x, -g.y, -g.z, -g.w);
      tracks[role].push(...g.toArray().map(r4));
    }
    const d = worldP(bones.get('Hips')).sub(hipsRest);
    hipsY.push(r4(d.y / hipH)); travel.push(d);
  }
  const covered = Math.hypot(travel.at(-1).x - travel[0].x, travel.at(-1).z - travel[0].z) / hipH;
  // Recorded in place (no travel): one stride per loop, two steps of about 0.9 hip heights each.
  const stride = covered > .2 ? covered : spec.loop ? (id === 'run' ? 2.6 : 1.5) : 0;
  out.clips[id] = { loop: spec.loop, duration: r4(clip.duration), frames, stride: r4(stride), hipsY, tracks };
  console.log(`${id}: ${clip.duration.toFixed(2)} s, ${frames} frames, travel ${covered.toFixed(2)} hip heights → stride ${stride.toFixed(2)}`);
}
const file = path.join(root, 'models/mobs/zombie-anims.json');
writeFileSync(file, JSON.stringify(out));
// Served as is (the asset manifest only carries model files).
writeFileSync(path.join(root, 'apps/web/public/models/mobs/zombie-anims.json'), JSON.stringify(out));
console.log(`${path.relative(root, file)}: ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
