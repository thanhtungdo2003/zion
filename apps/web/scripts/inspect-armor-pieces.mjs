/** Renders every node of the armour packs from the front (+Z camera) and the side, world-transformed,
 * to check each piece's facing. Writes .tmp-rig/raw.json for render-raw.py. Usage: tsx … [file:node …] */
import { readFile, writeFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
/** A GLB without any textures (Node cannot decode images): every texture reference removed. */
function untextured(buf) {
  const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const strip = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (/Texture$/.test(k) || k === 'KHR_texture_transform') delete o[k]; else strip(o[k]); } };
  for (const m of json.materials ?? []) strip(m);
  delete json.textures; delete json.images; delete json.samplers;
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + len), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8); head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, text, rest]); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
const files = { head: 'models/gear/armor/head-pack.glb', vest: 'models/gear/armor/vest-pack.glb', mil: 'models/gear/armor/military-helmet.glb', tac: 'models/gear/armor/tactical-helmet-headset.glb', k63: 'models/gear/armor/combat-helmet-k63.glb' };
const want = process.argv.slice(2);
const out = [];
for (const [key, file] of Object.entries(files)) {
  const gltf = await new GLTFLoader().parseAsync(untextured(await readFile(file)), '');
  gltf.scene.updateMatrixWorld(true);
  // Pieces: the scene's leaf groups that hold meshes (pack nodes), or the whole scene.
  const groups = new Map();
  gltf.scene.traverse((o) => { if (o.isMesh) { let p = o.parent; while (p && p.parent && p.parent.children.length === 1 && p.parent !== gltf.scene) p = p.parent; const name = p?.name || o.name; (groups.get(name) ?? groups.set(name, []).get(name)).push(o); } });
  for (const [name, meshes] of groups) {
    if (want.length && !want.some((w) => `${key}:${name}`.includes(w))) continue;
    const box = new Box3(); for (const m of meshes) box.expandByObject(m);
    const c = box.getCenter(new Vector3()), s = box.getSize(new Vector3()), k = 1.6 / Math.max(s.x, s.y, s.z);
    const mout = [];
    for (const m of meshes) {
      const g = m.geometry, pos = g.getAttribute('position'), positions = [], v = new Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(c).multiplyScalar(k); positions.push([v.x, v.y + .9, v.z]); }
      mout.push({ positions, colors: positions.map(() => [.62, .62, .55]), indices: g.index ? Array.from(g.index.array) : positions.map((_, i) => i) });
    }
    out.push({ label: `${key}:${name} ${s.toArray().map((x) => x.toFixed(2)).join('x')}`, meshes: mout });
  }
}
await writeFile('.tmp-rig/raw.json', JSON.stringify(out));
console.log(out.map((o) => o.label).join('\n'));
