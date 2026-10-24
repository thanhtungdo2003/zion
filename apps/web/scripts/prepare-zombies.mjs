// Split the supplied showroom into skins for the shared runtime gait.
// The dog and hunter sources are static: add fitted skeletons and skin weights.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, 'models/mobs');
const clone = x => structuredClone(x);
const read = async name => {
  const b = await fs.readFile(path.join(dir, 'source', name + '.glb'));
  const n = b.readUInt32LE(12);
  return { j: JSON.parse(b.subarray(20, 20 + n)), bin: b.subarray(28 + n), sha: createHash('sha256').update(b).digest('hex') };
};
function writer(j, original) {
  const buffers = [original]; let size = original.length;
  return {
    accessor(values, type, componentType = 5126) {
      const data = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
      const pad = (4 - size % 4) % 4; buffers.push(Buffer.alloc(pad), data);
      const bufferView = j.bufferViews.push({ buffer: 0, byteOffset: size + pad, byteLength: data.length }) - 1;
      size += pad + data.length;
      const components = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
      return j.accessors.push({ bufferView, componentType, count: values.length / components, type }) - 1;
    },
    binary: () => Buffer.concat(buffers),
  };
}
function compact(j, bin) {
  const accessors = new Set();
  for (const mesh of j.meshes) for (const p of mesh.primitives) {
    Object.values(p.attributes).forEach(i => accessors.add(i));
    if (p.indices !== undefined) accessors.add(p.indices);
    for (const target of p.targets ?? []) Object.values(target).forEach(i => accessors.add(i));
  }
  for (const skin of j.skins ?? []) if (skin.inverseBindMatrices !== undefined) accessors.add(skin.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { accessors.add(s.input); accessors.add(s.output); }
  const ai = new Map([...accessors].map((v, i) => [v, i]));
  j.accessors = [...accessors].map(i => clone(j.accessors[i]));
  const oldViews = j.bufferViews, buffers = []; let offset = 0;
  j.bufferViews = [];
  const store = bytes => {
    const pad = (4 - offset % 4) % 4;
    buffers.push(Buffer.alloc(pad), bytes);
    const i = j.bufferViews.push({ buffer: 0, byteOffset: offset + pad, byteLength: bytes.length }) - 1;
    offset += pad + bytes.length;
    return i;
  };
  // The source packs many models/animations into shared interleaved views. Copy
  // individual accessor elements, otherwise every split would still contain the showroom.
  for (const a of j.accessors) {
    if (a.sparse) throw new Error('Sparse accessor needs explicit expansion');
    if (a.bufferView === undefined) continue;
    const view = oldViews[a.bufferView];
    const elementSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] * { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const bytes = Buffer.alloc(a.count * elementSize), start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) bin.copy(bytes, i * elementSize, start + i * (view.byteStride ?? elementSize), start + i * (view.byteStride ?? elementSize) + elementSize);
    a.bufferView = store(bytes); delete a.byteOffset;
  }
  for (const image of j.images ?? []) if (image.bufferView !== undefined) {
    const v = oldViews[image.bufferView]; image.bufferView = store(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  }
  for (const mesh of j.meshes) for (const p of mesh.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = ai.get(p.attributes[k]);
    if (p.indices !== undefined) p.indices = ai.get(p.indices);
    for (const target of p.targets ?? []) for (const k of Object.keys(target)) target[k] = ai.get(target[k]);
  }
  for (const skin of j.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = ai.get(skin.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { s.input = ai.get(s.input); s.output = ai.get(s.output); }
  j.buffers = [{ byteLength: offset }];
  return Buffer.concat(buffers);
}
async function write(name, j, bin) {
  j.animations = []; // All skins use the common runtime locomotion solver.
  bin = compact(j, bin);
  let text = Buffer.from(JSON.stringify(j));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const header = Buffer.alloc(20), chunk = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + bin.length, 8);
  header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  chunk.writeUInt32LE(bin.length); chunk.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, text, chunk, bin]);
  await fs.writeFile(path.join(dir, name + '.glb'), output);
  console.log(`${name}: ${output.length} bytes, ${j.skins?.length ?? 0} skin, ${j.animations?.length ?? 0} clips`);
}
function aliases(nodes) {
  const find = pattern => nodes.find(n => pattern.test(n.name ?? ''))?.name;
  return { body: find(/bip.*Spine/i), hips: find(/bip.*Pelvis/i), head: find(/bip Head\d*_/i),
    arm_left: find(/bip L UpperArm/), arm_right: find(/bip R UpperArm/),
    forearm_left: find(/bip L Forearm/), forearm_right: find(/bip R Forearm/),
    leg_left: find(/bip L Thigh/), leg_right: find(/bip R Thigh/),
    shin_left: find(/bip L Calf/), shin_right: find(/bip R Calf/),
    hand_left: find(/bip L Hand/), hand_right: find(/bip R Hand/),
    foot_left: find(/bip L Foot/), foot_right: find(/bip R Foot/) };
}
const pack = await read('polyart_zombies_with_animations_free_pack');
const rigs = pack.j.nodes.map((n, i) => n.name?.startsWith('rig_CharRoot') ? i : -1).filter(i => i >= 0);
for (let variant = 0; variant < rigs.length; variant++) {
  const j = clone(pack.j), keep = new Set([0, 1, 2, 3]);
  const visit = i => { keep.add(i); for (const child of j.nodes[i].children ?? []) visit(child); };
  visit(rigs[variant]);
  j.nodes[rigs[variant]].translation = [0, 0, 0]; // Remove the showroom grid, never the bone animation.
  const ni = new Map([...keep].sort((a, b) => a - b).map((v, i) => [v, i]));
  const meshes = [...keep].flatMap(i => j.nodes[i].mesh !== undefined ? [j.nodes[i].mesh] : []);
  const mi = new Map(meshes.map((v, i) => [v, i]));
  const skin = j.nodes[[...keep].find(i => j.nodes[i].skin !== undefined)].skin;
  j.skins = [j.skins[skin]];
  j.skins[0].joints = j.skins[0].joints.map(i => ni.get(i));
  if (j.skins[0].skeleton !== undefined) j.skins[0].skeleton = ni.get(j.skins[0].skeleton);
  j.nodes = [...ni.keys()].map(i => {
    const n = j.nodes[i];
    if (n.children) n.children = n.children.filter(k => keep.has(k)).map(k => ni.get(k));
    if (n.mesh !== undefined) n.mesh = mi.get(n.mesh);
    if (n.skin !== undefined) n.skin = 0;
    return n;
  });
  j.meshes = meshes.map(i => j.meshes[i]);
  j.scenes = [{ name: `Polyart ${variant + 1}`, nodes: [0] }]; j.scene = 0;
  j.animations = [];
  j.extras = { zion_zombie: { kind: 'human', height: 1.82, aliases: aliases(j.nodes), source: 'polyart_zombies_with_animations_free_pack.glb', sourceHash: pack.sha, sourceVariant: variant, recorded: false } };
  await write(`polyart-zombie-${String(variant + 1).padStart(2, '0')}`, j, pack.bin);
}

// Static models are skinned in metre space. Blend the nearest anatomical segments,
// with separate limb regions to keep weights off the neighbouring leg or torso.
for (const kind of ['dog', 'hunter']) {
  const source = await read(kind === 'dog' ? 'low_poly_zombie_dog' : 'zombie_bind_hunter');
  const j = clone(source.j), frames = new Map();
  function walk(i, parent) {
    const n = j.nodes[i], local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local); frames.set(i, world);
    for (const c of n.children ?? []) walk(c, world);
  }
  for (const i of j.scenes[0].nodes) walk(i, new Matrix4());
  const meshNode = j.nodes.findIndex(n => n.mesh !== undefined), matrix = frames.get(meshNode);
  const primitive = j.meshes[j.nodes[meshNode].mesh].primitives[0];
  const accessor = j.accessors[primitive.attributes.POSITION], bv = j.bufferViews[accessor.bufferView];
  const points = Array.from({ length: accessor.count }, (_, i) => new Vector3().fromArray(new Float32Array(source.bin.buffer, source.bin.byteOffset + (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * 12, 3)).applyMatrix4(matrix));
  const min = new Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
  for (const p of points) { min.min(p); max.max(p); }
  const height = kind === 'dog' ? .95 : 1.9, factor = height / (max.y - min.y);
  const center = new Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
  for (const p of points) p.sub(center).multiplyScalar(factor);
  const B = (name, parent, p) => ({ name, parent, p: new Vector3(...p).multiplyScalar(height) });
  const bones = kind === 'dog' ? [
    B('hips', -1, [0, .68, -.35]), B('body', 0, [0, .73, .2]), B('head', 1, [0, .71, .52]),
    B('leg_left', 0, [.16, .63, -.44]), B('shin_left', 3, [.16, .31, -.51]), B('foot_left', 4, [.16, .05, -.53]),
    B('leg_right', 0, [-.16, .63, -.44]), B('shin_right', 6, [-.16, .31, -.51]), B('foot_right', 7, [-.16, .05, -.53]),
    B('arm_left', 1, [.16, .63, .21]), B('forearm_left', 9, [.16, .32, .25]), B('hand_left', 10, [.16, .04, .28]),
    B('arm_right', 1, [-.16, .63, .21]), B('forearm_right', 12, [-.16, .32, .25]), B('hand_right', 13, [-.16, .04, .28]),
    B('tail', 0, [0, .72, -.57]), B('tail_tip', 15, [0, .5, -.78]),
  ] : [
    B('hips', -1, [0, .48, 0]), B('body', 0, [0, .7, .01]), B('head', 1, [0, .86, .06]),
    B('leg_left', 0, [.1, .46, 0]), B('shin_left', 3, [.1, .24, .025]), B('foot_left', 4, [.1, .05, .05]),
    B('leg_right', 0, [-.1, .46, 0]), B('shin_right', 6, [-.1, .24, .025]), B('foot_right', 7, [-.1, .05, .05]),
    B('arm_left', 1, [.22, .77, .01]), B('forearm_left', 9, [.31, .58, .02]), B('hand_left', 10, [.39, .43, .06]),
    B('arm_right', 1, [-.22, .77, .01]), B('forearm_right', 12, [-.31, .58, .02]), B('hand_right', 13, [-.39, .43, .06]),
  ];
  const w = writer(j, source.bin);
  primitive.attributes.POSITION = w.accessor(new Float32Array(points.flatMap(p => p.toArray())), 'VEC3');
  const posAcc = j.accessors[primitive.attributes.POSITION];
  posAcc.min = min.sub(center).multiplyScalar(factor).toArray(); posAcc.max = max.sub(center).multiplyScalar(factor).toArray();
  // Transform authored normals with their mesh frame, retain the original UVs/material/texture.
  const na = j.accessors[primitive.attributes.NORMAL], nv = j.bufferViews[na.bufferView];
  const normals = Array.from({ length: na.count }, (_, i) => new Vector3().fromArray(new Float32Array(source.bin.buffer, source.bin.byteOffset + (nv.byteOffset ?? 0) + (na.byteOffset ?? 0) + i * 12, 3)).transformDirection(matrix));
  primitive.attributes.NORMAL = w.accessor(new Float32Array(normals.flatMap(p => p.toArray())), 'VEC3'); delete primitive.attributes.TANGENT;
  const joints = [], weights = [];
  const distance = (p, a, b) => { const d = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(d) / Math.max(1e-9, d.lengthSq()))); return p.distanceTo(a.clone().addScaledVector(d, t)); };
  for (const p of points) {
    const h = p.y / height, x = p.x / height, z = p.z / height;
    let allowed;
    if (kind === 'dog') allowed = z < -.55 ? [0, 15, 16] : z > .39 && h > .47 ? [1, 2] : h > .59 ? [0, 1] : z < -.12 ? (x > 0 ? [3, 4, 5] : [6, 7, 8]) : (x > 0 ? [9, 10, 11] : [12, 13, 14]);
    else allowed = h > .84 ? [1, 2] : h < .46 ? (x > 0 ? [3, 4, 5] : [6, 7, 8]) : Math.abs(x) > .19 ? (x > 0 ? [9, 10, 11] : [12, 13, 14]) : [0, 1];
    const ranked = allowed.map(i => { const child = bones.find(b => b.parent === i); return [i, distance(p, bones[i].p, child?.p ?? bones[i].p)] }).sort((a, b) => a[1] - b[1]).slice(0, 2);
    const scores = ranked.map(a => 1 / Math.pow(a[1] + height * .035, 4)); const total = scores.reduce((a, b) => a + b, 0);
    joints.push(ranked[0][0], ranked[1]?.[0] ?? ranked[0][0], 0, 0); weights.push(scores[0] / total, (scores[1] ?? 0) / total, 0, 0);
  }
  primitive.attributes.JOINTS_0 = w.accessor(new Uint16Array(joints), 'VEC4', 5123);
  primitive.attributes.WEIGHTS_0 = w.accessor(new Float32Array(weights), 'VEC4');
  j.meshes = [{ name: kind, primitives: [primitive] }];
  j.nodes = bones.map(b => ({ name: b.name, translation: b.p.clone().sub(b.parent >= 0 ? bones[b.parent].p : new Vector3()).toArray(), children: bones.flatMap((c, i) => c.parent === bones.indexOf(b) ? [i] : []) }));
  j.nodes.push({ name: kind + '_skin', mesh: 0, skin: 0 });
  j.scenes = [{ name: kind, nodes: [0, bones.length] }]; j.scene = 0;
  const inverse = bones.flatMap(b => new Matrix4().makeTranslation(-b.p.x, -b.p.y, -b.p.z).toArray());
  j.skins = [{ joints: bones.map((_, i) => i), skeleton: 0, inverseBindMatrices: w.accessor(new Float32Array(inverse), 'MAT4') }];
  j.animations = [];
  j.extras = { zion_zombie: { kind, height, aliases: Object.fromEntries(bones.map(b => [b.name, b.name])), source: kind === 'dog' ? 'low_poly_zombie_dog.glb' : 'zombie_bind_hunter.glb', sourceHash: source.sha, recorded: false } };
  await write(`zombie-${kind}`, j, w.binary());
}
