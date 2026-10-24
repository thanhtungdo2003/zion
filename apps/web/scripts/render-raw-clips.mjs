/** Plays clips of the survivor GLB with a plain AnimationMixer (no procedural layers) and writes
 * skinned triangles to .tmp-rig/raw.json for render-raw.py. Usage: node render-raw-clips.mjs clip@t ... */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { AnimationMixer, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const file = process.env.GLB ?? 'models/characters/zion-survivor.glb';
const glb = await readFile(file);
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
const specs = process.argv.slice(2).length ? process.argv.slice(2) : ['rest@0'];
const out = [];
for (const spec of specs) {
  const [name, t] = spec.split('@');
  const scene = gltf.scene;
  scene.traverse((o) => { if (o.isBone && o.userData.rest) { o.position.copy(o.userData.rest[0]); o.quaternion.copy(o.userData.rest[1]); } else if (o.isBone) o.userData.rest = [o.position.clone(), o.quaternion.clone()]; });
  const mixer = new AnimationMixer(scene);
  const clip = gltf.animations.find((c) => c.name === name);
  if (clip) { mixer.clipAction(clip).play(); mixer.setTime(+t); }
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || !o.visible) return;
    const g = o.geometry, pos = g.attributes.position, col = g.attributes.color, v = new Vector3();
    const positions = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); positions.push([+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]); }
    const colors = [];
    for (let i = 0; i < pos.count; i++) colors.push(col ? [col.getX(i), col.getY(i), col.getZ(i)] : [.8, .7, .6]);
    meshes.push({ name: o.name, positions, colors, indices: Array.from(g.index.array) });
  });
  out.push({ label: spec + (clip ? '' : ' (missing)'), meshes });
  mixer.stopAllAction();
}
await mkdir('.tmp-rig', { recursive: true });
await writeFile('.tmp-rig/raw.json', JSON.stringify(out));
console.log('clips:', gltf.animations.map((c) => `${c.name}(${c.duration.toFixed(2)})`).join(' '));
