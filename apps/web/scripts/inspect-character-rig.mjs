/** CPU mesh inspection: evaluates the real skin/morphs and weapon without a WebGL/browser stub.
 * Run using tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/inspect-character-rig.mjs.
 * Writes .tmp-rig/poses.json for render-rig.py (Pillow). */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Color, Group, Mesh, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from '../src/game/render/avatars';
import { BB_UNITS_PER_METER, buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';
import { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual } from '../src/game/render/weapons';
import { rifleStockContact } from '../src/game/render/grip-profile';
import { ViewModel } from '../src/game/render/viewmodel';
import { PerspectiveCamera } from 'three';

const raw = async (url) => {
  const data = JSON.parse(await readFile(url, 'utf8'));
  data.textures = [];
  return buildBBModel(data);
};
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const gunTemplate = await raw('models/weapons/ak47-rifle.bbmodel');
const spec = fittedSpec(builtinWeaponVisual('ak47'), gunTemplate);
const grip = new Vector3(...spec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
const visual = {
  ...standaloneVisual('ak47', spec, gunTemplate.root, template),
  attach: fitToHand(template, spec, 'rifle', gunTemplate.root),
  aim: { barrel: new Vector3(...spec.barrel), up: new Vector3(...spec.up), grip },
  twoHandGrip: { grip, support: new Vector3(...spec.support).multiplyScalar(1 / BB_UNITS_PER_METER), up: new Vector3(...spec.up), triggerHand: 'right' },
};
const samples = [];
if (process.argv.includes('--diagnose')) {
  const avatar = new Avatar(template, true);
  avatar.viewAligned = true;
  avatar.setStance('rifle'); avatar.setWeapon('ak47', new Map([['ak47', visual]]));
  let z = 0;
  for (let i = 0; i < 180; i++) {
    if (i > 60) z -= 3 / 60;
    avatar.update(0, 0, z, 0, EntityFlags.Grounded, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true);
    if ([60, 61, 75, 120, 179].includes(i)) {
      const heading = (name) => {
        const local = new Vector3(0, 0, 1).applyQuaternion(human.restQ[human.index.get(name)].clone().invert());
        const dir = local.applyQuaternion(avatar.root.getObjectByName(name).getWorldQuaternion(new Quaternion()));
        return Math.atan2(-dir.x, -dir.z) * 180 / Math.PI;
      };
      console.log(i, avatar.mocap.clip, 'root', avatar.root.rotation.y, 'hips', heading('spine'), 'chest', heading('spine_003'));
    }
  }
  const camera = new PerspectiveCamera(75, 16 / 9, .02, 100), view = new ViewModel(camera);
  // The production display is oriented +X with the grip at the origin.
  const fp = visual.display.children[0]?.matrix ?? visual.display.matrix;
  visual.firstPersonSupport = { arm: new Group(), contact: new Vector3(...spec.support).multiplyScalar(1 / BB_UNITS_PER_METER).applyMatrix4(fp) };
  view.setBody(human); view.set('ak47', new Map([['ak47', visual]]));
  for (let i = 0; i < 90; i++) { view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 }); camera.updateMatrixWorld(true); }
  for (const s of ['L', 'R']) {
    const forearm = camera.getObjectByName(`forearm_${s}`), hand = camera.getObjectByName(`hand_${s}`);
    const fore = hand.getWorldPosition(new Vector3()).sub(forearm.getWorldPosition(new Vector3())).normalize();
    const rest = human.bones[human.index.get(`forearm_${s}_001`)].quaternion.clone().multiply(human.bones[human.index.get(`hand_${s}`)].quaternion);
    const expected = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()).multiply(rest.invert()));
    console.log('FP', s, 'wrist swing', fore.angleTo(expected) * 180 / Math.PI, 'fore', fore.toArray(), 'hand forward', expected.toArray());
  }
  view.dispose();
  process.exit(0);
}
const A = EntityFlags.Aiming, C = EntityFlags.Crouching, P = EntityFlags.Prone;
const reload = process.argv.includes('--reload');
const firstPerson = process.argv.includes('--first-person');
const states = firstPerson ? [
  ['fp-hip', 0, 0, 0, 90], ['fp-aim', 0, 0, A, 90], ['fp-run', 0, -2.8, A, 90], ['fp-reload-40%', 0, 0, 0, 79],
] : reload ? [
  ['reload-10%', 0, 0, 0, 20], ['reload-30%', 0, 0, 0, 60], ['reload-50%', 0, 0, 0, 99],
  ['reload-70%', 0, 0, 0, 139], ['reload-90%', 0, 0, 0, 178],
] : process.argv.includes('--aim') ? [
  ['aim', 0, 0, A, 180], ['rifle-run', 0, -2.8, A, 180],
] : process.argv.includes('--postures') ? [
  ['aim', 0, 0, A, 180], ['rifle-run', 0, -2.8, A, 180],
  ['run-left', -3, 0, A, 180], ['run-right', 3, 0, A, 180],
  ['kneel', 0, 0, C | A, 220], ['crouch-forward', 0, -1.2, C, 220],
  ['crouch-left', -1.2, 0, C, 220], ['prone-aim', 0, 0, P | A, 300],
  ['crawl', 0, -.6, P, 300], ['prone-turn', 0, 0, P, 300, .8],
] : [
  ['idle', 0, 0, 0, 120], ['aim', 0, 0, A, 120],
  ['start', 0, -4, 0, 24], ['run', 0, -5.9, EntityFlags.Sprinting, 180],
  ['back', 0, 5.9, EntityFlags.Sprinting, 180], ['walk-aim', 0, -2.8, A, 180],
];
for (const [label, vx, vz, flags, frames, yaw = 0] of states) {
  const avatar = new Avatar(template, true);
  avatar.setStance('rifle'); avatar.setWeapon('ak47', new Map([['ak47', visual]]));
  avatar.viewAligned = true;
  for (let i = 0; i < 60; i++) { avatar.update(0, 0, 0, 0, EntityFlags.Grounded | (flags & EntityFlags.Aiming), 1 / 60, i / 60); avatar.root.updateMatrixWorld(true); }
  if (reload) avatar.startReload(3.3);
  for (let i = 1; i <= frames; i++) { avatar.update(vx * i / 60, 0, vz * i / 60, yaw * Math.max(0, (i - frames + 45) / 45), EntityFlags.Grounded | flags, 1 / 60, i / 60); avatar.root.updateMatrixWorld(true); }
  avatar.root.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  let scene = avatar.root;
  let view;
  if (firstPerson) {
    const camera = new PerspectiveCamera(75, 1, .02, 100);
    view = new ViewModel(camera); view.setBody(human); view.set('ak47', new Map([['ak47', visual]]));
    if (label.includes('reload')) view.reload(3.3);
    for (let i = 0; i < frames; i++) {
      view.update(1 / 60, { visible: true, moving: vz !== 0, sprint: false, reloading: label.includes('reload'), aiming: (flags & A) !== 0, yaw: 0, pitch: 0 });
      camera.updateMatrixWorld(true);
    }
    camera.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
    scene = camera;
  }
  const meshes = [];
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    let p = o.parent;
    while (p) { if (!p.visible) return; p = p.parent; }
    const geometry = o.geometry, count = geometry.getAttribute('position').count;
    const positions = [], colors = [];
    const attribute = geometry.getAttribute('color');
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    const tint = 'color' in material ? material.color : new Color(.5, .5, .5);
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(scene.position);
      positions.push(v.toArray());
      const c = attribute ? new Color(attribute.getX(i), attribute.getY(i), attribute.getZ(i)).multiply(tint) : tint.clone();
      c.convertLinearToSRGB(); colors.push(c.toArray());
    }
    meshes.push({ name: o.name, positions, colors, indices: geometry.index ? Array.from(geometry.index.array) : Array.from({ length: count }, (_, i) => i) });
  });
  const joint = (n) => avatar.root.getObjectByName(n).getWorldPosition(new Vector3()).sub(avatar.root.position);
  samples.push({ label, meshes, focus: joint('hand_R').add(joint('hand_L')).multiplyScalar(.5).toArray() });
  view?.dispose();
  const shoulder = joint('upper_arm_R'), elbow = joint('forearm_R'), wrist = joint('hand_R');
  console.log(label, 'R elbow', (180 - elbow.clone().sub(shoulder).angleTo(elbow.clone().sub(wrist)) * 180 / Math.PI).toFixed(1), 'wrist', wrist.toArray().map((n) => +n.toFixed(3)));
  if (process.argv.includes('--aim')) {
    console.log('head', joint('spine_006').toArray(), 'neck', joint('spine_004').toArray(), 'shoulder', shoulder.toArray());
    console.log('head rest', human.restP[human.index.get('spine_006')].toArray());
    const held = avatar.root.getObjectByName('held-weapon') ?? [...avatar.weaponObjects.values()][0].obj;
    const scale = new Vector3().setFromMatrixScale(held.matrixWorld);
    const stock = rifleStockContact(held, grip.clone().multiply(scale), visual.aim.barrel.clone().normalize(), visual.aim.up.clone().normalize(), 1);
    if (stock) {
      const contact = stock.applyQuaternion(held.getWorldQuaternion(new Quaternion())).add(held.getWorldPosition(new Vector3()));
      console.log('cheek-to-stock', avatar.human.rifleCheek('R').distanceTo(contact).toFixed(3));
    }
  }
  if (flags & P) {
    const spine = joint('spine_006').sub(joint('spine'));
    console.log('  prone heading', Math.atan2(-spine.x, -spine.z).toFixed(3), 'root', avatar.root.rotation.y.toFixed(3));
  }
}
await mkdir('.tmp-rig', { recursive: true });
const output = firstPerson ? '.tmp-rig/poses-fp.json' : reload ? '.tmp-rig/poses-reload.json' : '.tmp-rig/poses.json';
await writeFile(output, JSON.stringify(samples));
console.log(`Wrote actual posed meshes to ${output}`);
