// Offline: Sketchfab gun GLBs (often skinned, parts as bones) → static GLBs whose moving parts are
// named groups the game animates (`magazine`, `bolt`), in the file's own units so the weapon
// table's points stay valid. Run: node apps/web/scripts/prepare-glb-guns.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.join(root, 'models/sources/guns'), out = path.join(root, 'apps/web/public/models/weapons');

/**
 * Each gun: source file, output name, and how a triangle finds its part — by the bone that moves
 * most of its vertices (skinned files) or by its mesh's name. Unlisted: the fixed body.
 */
const GUNS = [
  // This M16 is modelled about half as thick as the real rifle: widened (x2 across).
  { file: 'low-poly_m16.glb', name: 'm16.glb', widen: [1, 1, 2], bones: { magazine: /^(mag|bullet|bullets)_/, bolt: /^(charginghandle|bolt)_/ } },
  { file: 'low-poly_fb_beryl.glb', name: 'beryl.glb', bones: { magazine: /^(mag|bullet|bullets)_/, bolt: /^bolt_/ } },
  { file: 'm762_assault_rifle.glb', name: 'm762.glb', meshes: { magazine: /^3DGeom~11_/, bolt: /^3DGeom~[12]_/ } },
];

for (const gun of GUNS) {
  const buf = await fs.readFile(path.join(src, gun.file));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  // part → material → triangles (scene-space positions)
  const groups = new Map();
  const v = new Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.getAttribute('position'), idx = g.index;
    // As the game unskins: skinned vertex in the mesh's space, then the mesh's own node chain.
    const m = o.isSkinnedMesh ? o.parent.matrixWorld.clone().multiply(new Matrix4().compose(o.position, o.quaternion, o.scale)) : o.matrixWorld;
    const world = [];
    for (let i = 0; i < pos.count; i++) { if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); world.push(v.clone().applyMatrix4(m).multiply(new Vector3(...(gun.widen ?? [1, 1, 1])))); }
    const skinIndex = g.getAttribute('skinIndex'), skinWeight = g.getAttribute('skinWeight');
    const vertexPart = (i) => {
      if (gun.meshes) return Object.keys(gun.meshes).find((p) => gun.meshes[p].test(o.name)) ?? 'body';
      if (!o.isSkinnedMesh || !skinIndex) return 'body';
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > w) { w = skinWeight.getComponent(i, k); best = skinIndex.getComponent(i, k); }
      const bone = o.skeleton.bones[best]?.name ?? '';
      return Object.keys(gun.bones).find((p) => gun.bones[p].test(bone)) ?? 'body';
    };
    const n = idx ? idx.count : pos.count;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    for (let t = 0; t + 2 < n; t += 3) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      const parts = tri.map(vertexPart), part = parts[1] === parts[2] ? parts[1] : parts[0];
      if (!groups.has(part)) groups.set(part, new Map());
      const byMat = groups.get(part);
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(...tri.map((k) => world[k]));
    }
  });
  await fs.writeFile(path.join(out, gun.name), writeGlb(groups));
  console.log(gun.name, [...groups.entries()].map(([p, m]) => `${p}: ${[...m.values()].reduce((s, a) => s + a.length / 3, 0)} tris`).join(', '));
}

/** Static GLB: the body's meshes at the root, each moving part a named group at its centre. */
function writeGlb(groups) {
  const json = { asset: { version: '2.0', generator: 'ZION gun preparation' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = []; let length = 0;
  const view = (data, target) => { const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; } json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target }); chunks.push(data); length += data.length; return json.bufferViews.length - 1; };
  const materials = new Map();
  const material = (m) => {
    if (!materials.has(m)) {
      const c = m.color ?? { r: .2, g: .2, b: .2 };
      json.materials.push({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [c.r, c.g, c.b, 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? .8 }, doubleSided: !!m.side });
      materials.set(m, json.materials.length - 1);
    }
    return materials.get(m);
  };
  for (const [part, byMat] of groups) {
    const all = [...byMat.values()].flat();
    const centre = part === 'body' ? new Vector3() : all.reduce((s, p) => s.add(p), new Vector3()).divideScalar(all.length);
    const primitives = [];
    for (const [mat, verts] of byMat) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(verts.flatMap((p) => [p.x - centre.x, p.y - centre.y, p.z - centre.z])), 3));
      g.computeVertexNormals();
      const P = g.getAttribute('position').array, N = g.getAttribute('normal').array;
      const min = [0, 1, 2].map((i) => Math.min(...P.filter((_, k) => k % 3 === i))), max = [0, 1, 2].map((i) => Math.max(...P.filter((_, k) => k % 3 === i)));
      json.accessors.push({ bufferView: view(Buffer.from(P.buffer.slice(0)), 34962), componentType: 5126, count: P.length / 3, type: 'VEC3', min, max });
      const pa = json.accessors.length - 1;
      json.accessors.push({ bufferView: view(Buffer.from(N.buffer.slice(0)), 34962), componentType: 5126, count: N.length / 3, type: 'VEC3' });
      primitives.push({ attributes: { POSITION: pa, NORMAL: json.accessors.length - 1 }, material: material(mat) });
    }
    json.meshes.push({ name: `${part}-mesh`, primitives });
    const meshNode = { name: `${part}-mesh`, mesh: json.meshes.length - 1 };
    if (part === 'body') { json.nodes.push(meshNode); json.scenes[0].nodes.push(json.nodes.length - 1); }
    else {
      json.nodes.push(meshNode);
      json.nodes.push({ name: part, translation: centre.toArray(), children: [json.nodes.length - 1] });
      json.scenes[0].nodes.push(json.nodes.length - 1);
    }
  }
  const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
  json.buffers[0].byteLength = length;
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + length, 8); header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const bin = Buffer.alloc(8); bin.writeUInt32LE(length); bin.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, text, bin, ...chunks]);
}
