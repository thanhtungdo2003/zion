// Packs a ModelGen character batch (a reference body plus one GLB per garment / hairstyle, all
// skinned to the same 162-bone Rigify skeleton) into the single game model
// models/characters/zion-survivor.glb:
//   - one skeleton and skin, shared by every part;
//   - one mesh per part (its primitives merged), named after the part, with `extras.part`;
//   - quantised attributes (int8 normals, uint8 colours / joints / weights), duplicate vertices
//     welded, the hairstyle's faceted strands smoothed within a crease angle;
//   - `_ANCHOR` on the hairstyle: the nearest scalp vertex of the body, used by the game to
//     derive shorter haircuts from the same strands.
// Usage: node scripts/prepare-character.mjs <batch dir with manifest.json> [out.glb]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [dir, outArg] = process.argv.slice(2);
if (!dir) { console.error('usage: prepare-character <batch dir> [out.glb]'); process.exit(1); }
const out = outArg ?? path.resolve(import.meta.dirname, '../../../models/characters/zion-survivor.glb');
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

function loadGlb(file) {
  const buf = readFileSync(file), jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i) => {
    const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? n * T.BYTES_PER_ELEMENT;
    const outArr = new T(a.count * n), view = new DataView(bin.buffer, bin.byteOffset);
    const get = { 5126: (o) => view.getFloat32(o, true), 5125: (o) => view.getUint32(o, true), 5123: (o) => view.getUint16(o, true), 5121: (o) => view.getUint8(o) }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) outArr[k * n + c] = get(base + k * stride + c * T.BYTES_PER_ELEMENT);
    return outArr;
  };
  return { gltf, read };
}

// ---- skeleton (from the reference body) ----
/** Rigify names without the DEF- prefix or dots (three.js strips dots from node names): upper_arm_L_001. */
const boneName = (n) => n.replace(/^DEF-/, '').replace(/\./g, '_');
const body = loadGlb(path.join(dir, manifest.body.file));
const skin = body.gltf.skins[0];
const jointNodes = skin.joints;
const jointNames = jointNodes.map((n) => body.gltf.nodes[n].name);
const nodeToJoint = new Map(jointNodes.map((n, j) => [n, j]));
const parentOf = new Map();
body.gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const bones = jointNodes.map((n) => {
  const node = body.gltf.nodes[n];
  const p = parentOf.get(n);
  if (p !== undefined && !nodeToJoint.has(p)) throw new Error(`joint ${node.name} has a non-joint parent`);
  return { name: boneName(node.name), parent: p === undefined ? -1 : nodeToJoint.get(p), t: node.translation ?? [0, 0, 0], r: node.rotation ?? [0, 0, 0, 1], s: node.scale ?? [1, 1, 1] };
});
const ibm = body.read(skin.inverseBindMatrices);

// ---- parts ----
const PARTS = [
  { file: manifest.body.file, part: 'body', slot: 'body', meshes: ['body'] },
  { file: manifest.body.file, part: 'eyes', slot: 'eyes', meshes: ['eyes'] },
  ...manifest.assets.map((a) => ({ file: a.file, part: a.type, slot: a.family === 'hair' ? 'hair' : a.family === 'footwear' ? 'feet' : a.type === 'belt' ? 'belt' : /pants|trousers|shorts/.test(a.type) ? 'legs' : 'top', name: a.name })),
];

const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

function mergePart(spec) {
  const { gltf, read } = loadGlb(path.join(dir, spec.file));
  const names = gltf.skins[0].joints.map((n) => gltf.nodes[n].name);
  const remap = names.map((n) => { const j = jointNames.indexOf(n); if (j < 0) throw new Error(`${spec.file}: unknown joint ${n}`); return j; });
  const pos = [], nrm = [], col = [], jnt = [], wgt = [], idx = [];
  let roughness = 0.8, metalness = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes[node.mesh];
    if (spec.meshes && !spec.meshes.includes(mesh.name)) continue;
    if (node.translation || node.rotation || node.scale || node.matrix) throw new Error(`${spec.file}: transformed mesh node`);
    for (const prim of mesh.primitives) {
      const mat = gltf.materials[prim.material]?.pbrMetallicRoughness ?? {};
      if (!pos.length) { roughness = mat.roughnessFactor ?? 0.8; metalness = mat.metallicFactor ?? 0; }
      const tint = mat.baseColorFactor ?? [1, 1, 1, 1];
      const P = read(prim.attributes.POSITION), N = read(prim.attributes.NORMAL), C = read(prim.attributes.COLOR_0);
      const J = read(prim.attributes.JOINTS_0), W = read(prim.attributes.WEIGHTS_0);
      const base = pos.length / 3, count = P.length / 3, cn = C.length / count;
      for (let i = 0; i < count; i++) {
        pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        nrm.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        col.push(C[i * cn] * tint[0], C[i * cn + 1] * tint[1], C[i * cn + 2] * tint[2]);
        for (let c = 0; c < 4; c++) { jnt.push(remap[J[i * 4 + c]]); wgt.push(W[i * 4 + c]); }
      }
      const I = prim.indices !== undefined ? read(prim.indices) : Array.from({ length: count }, (_, i) => i);
      for (const k of I) idx.push(base + k);
    }
  }
  return { pos, nrm, col, jnt, wgt, idx, roughness, metalness };
}

/** Smooths normals across faces meeting at a position within `crease` radians (hair strands). */
function creaseNormals(m, crease) {
  const groups = new Map();
  const key = (i) => `${m.pos[i * 3].toFixed(5)},${m.pos[i * 3 + 1].toFixed(5)},${m.pos[i * 3 + 2].toFixed(5)}`;
  const n = m.pos.length / 3;
  for (let i = 0; i < n; i++) { const k = key(i); let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(i); }
  const cos = Math.cos(crease), outN = m.nrm.slice();
  for (const g of groups.values()) {
    for (const i of g) {
      let x = 0, y = 0, z = 0;
      for (const j of g) {
        const d = m.nrm[i * 3] * m.nrm[j * 3] + m.nrm[i * 3 + 1] * m.nrm[j * 3 + 1] + m.nrm[i * 3 + 2] * m.nrm[j * 3 + 2];
        if (d >= cos) { x += m.nrm[j * 3]; y += m.nrm[j * 3 + 1]; z += m.nrm[j * 3 + 2]; }
      }
      const l = Math.hypot(x, y, z) || 1;
      outN[i * 3] = x / l; outN[i * 3 + 1] = y / l; outN[i * 3 + 2] = z / l;
    }
  }
  m.nrm = outN;
}

/** Quantises and welds identical vertices. */
function pack(m) {
  const n = m.pos.length / 3, seen = new Map(), map = new Uint32Array(n);
  const P = [], N = [], C = [], J = [], W = [];
  for (let i = 0; i < n; i++) {
    const p = [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
    const nn = [q8(m.nrm[i * 3]), q8(m.nrm[i * 3 + 1]), q8(m.nrm[i * 3 + 2])];
    const c = [u8(m.col[i * 3]), u8(m.col[i * 3 + 1]), u8(m.col[i * 3 + 2])];
    // Weights: the four largest, normalised to bytes that sum to exactly 255.
    const inf = [0, 1, 2, 3].map((k) => [m.jnt[i * 4 + k], m.wgt[i * 4 + k]]).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
    const total = inf.reduce((s, [, w]) => s + w, 0) || 1;
    const jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
    let left = 255;
    inf.forEach(([j, w], k) => { jj[k] = j; ww[k] = k === inf.length - 1 ? left : Math.round((w / total) * 255); left -= ww[k]; });
    if (ww.some((w) => w < 0)) { ww.fill(0); ww[0] = 255; }
    const key = `${p.map((v) => v.toFixed(5))}|${nn}|${c}|${jj}|${ww}`;
    let at = seen.get(key);
    if (at === undefined) { at = P.length / 3; seen.set(key, at); P.push(...p); N.push(...nn); C.push(...c); J.push(...jj); W.push(...ww); }
    map[i] = at;
  }
  return { P: new Float32Array(P), N: new Int8Array(N), C: new Uint8Array(C), J: new Uint8Array(J), W: new Uint8Array(W), I: Uint32Array.from(m.idx, (k) => map[k]), roughness: m.roughness, metalness: m.metalness };
}

const parts = PARTS.map((spec) => {
  const merged = mergePart(spec);
  if (spec.slot === 'hair') creaseNormals(merged, 40 * Math.PI / 180);
  const packed = pack(merged);
  console.log(`${spec.part}: ${merged.pos.length / 3} → ${packed.P.length / 3} vertices, ${packed.I.length / 3} triangles`);
  return { ...spec, ...packed };
});

// Hair anchors: the nearest scalp (head-weighted) vertex of the body for every hair vertex.
const bodyPart = parts.find((p) => p.part === 'body');
const HEAD = new Set(jointNames.map((n, j) => (/^DEF-(spine\.006|forehead|temple|ear|brow\.T)/.test(n) ? j : -1)).filter((j) => j >= 0));
const scalp = [];
for (let i = 0; i < bodyPart.P.length / 3; i++) {
  let w = 0;
  for (let k = 0; k < 4; k++) if (HEAD.has(bodyPart.J[i * 4 + k])) w += bodyPart.W[i * 4 + k];
  if (w >= 128 && bodyPart.P[i * 3 + 1] > 1.45) scalp.push(i);
}
for (const p of parts) {
  if (p.slot !== 'hair') continue;
  const n = p.P.length / 3;
  p.anchor = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bd = Infinity;
    for (const s of scalp) {
      const dx = p.P[i * 3] - bodyPart.P[s * 3], dy = p.P[i * 3 + 1] - bodyPart.P[s * 3 + 1], dz = p.P[i * 3 + 2] - bodyPart.P[s * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    p.anchor[i] = best;
  }
}

// ---- write the GLB ----
const chunks = [];
let byteLength = 0;
const bufferViews = [], accessors = [];
function addView(arr, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: b.length, ...(target ? { target } : {}) });
  chunks.push(b); byteLength += b.length;
  return bufferViews.length - 1;
}
const COMPONENT = (arr) => (arr instanceof Float32Array ? 5126 : arr instanceof Uint32Array ? 5125 : arr instanceof Uint16Array ? 5123 : arr instanceof Int8Array ? 5120 : 5121);
function addAccessor(arr, type, extra = {}, target = 34962) {
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
  // Vertex attributes need 4-byte aligned elements: pad short vectors (bytes, uint16) to 4 bytes.
  const elem = n * arr.BYTES_PER_ELEMENT;
  if (target === 34962 && elem % 4) {
    const width = Math.ceil(elem / 4) * 4 / arr.BYTES_PER_ELEMENT, count = arr.length / n;
    const data = new arr.constructor(count * width);
    for (let i = 0; i < count; i++) for (let c = 0; c < n; c++) data[i * width + c] = arr[i * n + c];
    const view = addView(data, target);
    bufferViews[view].byteStride = width * arr.BYTES_PER_ELEMENT;
    accessors.push({ bufferView: view, componentType: COMPONENT(arr), count, type, ...extra });
    return accessors.length - 1;
  }
  const view = addView(arr, target);
  accessors.push({ bufferView: view, componentType: COMPONENT(arr), count: arr.length / n, type, ...extra });
  return accessors.length - 1;
}

const nodes = bones.map((b) => ({ name: b.name, translation: b.t, rotation: b.r, ...(b.s.some((v) => Math.abs(v - 1) > 1e-6) ? { scale: b.s } : {}) }));
bones.forEach((b, j) => { if (b.parent >= 0) (nodes[b.parent].children ??= []).push(j); });
const ibmAccessor = addAccessor(ibm, 'MAT4', {}, undefined);
const materials = [], meshes = [];
for (const p of parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.P.length; i++) { min[i % 3] = Math.min(min[i % 3], p.P[i]); max[i % 3] = Math.max(max[i % 3], p.P[i]); }
  const attributes = {
    POSITION: addAccessor(p.P, 'VEC3', { min, max }),
    NORMAL: addAccessor(p.N, 'VEC3', { normalized: true }),
    COLOR_0: addAccessor(p.C, 'VEC3', { normalized: true }),
    JOINTS_0: addAccessor(p.J, 'VEC4'),
    WEIGHTS_0: addAccessor(p.W, 'VEC4', { normalized: true }),
    ...(p.anchor ? { _ANCHOR: addAccessor(p.anchor, 'SCALAR') } : {}),
  };
  const index = p.P.length / 3 < 65536 ? Uint16Array.from(p.I) : p.I;
  materials.push({ name: p.part, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: p.metalness, roughnessFactor: p.roughness } });
  meshes.push({ name: p.part, extras: { part: p.part, slot: p.slot, ...(p.name ? { label: p.name } : {}) }, primitives: [{ attributes, indices: addAccessor(index, 'SCALAR', {}, 34963), material: materials.length - 1 }] });
}
const meshNodes = meshes.map((m, i) => { nodes.push({ name: m.name, mesh: i, skin: 0 }); return nodes.length - 1; });
const rootJoint = bones.findIndex((b) => b.parent < 0);
const gltf = {
  asset: { version: '2.0', generator: 'zion prepare-character' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [rootJoint, ...meshNodes], extras: { format: 'zion-survivor@1', batchId: manifest.batchId, name: manifest.name, reference: manifest.reference, parts: parts.map((p) => ({ part: p.part, slot: p.slot })) } }],
  nodes,
  skins: [{ joints: bones.map((_, j) => j), inverseBindMatrices: ibmAccessor, skeleton: rootJoint }],
  meshes, materials, accessors, bufferViews,
  buffers: [{ byteLength }],
};
const bin = Buffer.concat(chunks);
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4);
const file = Buffer.concat([header, jh, json, bh, binPadded]);
writeFileSync(out, file);
console.log(`${path.relative(process.cwd(), out)}: ${(file.length / 1048576).toFixed(2)} MB, sha256 ${createHash('sha256').update(file).digest('hex').slice(0, 12)}`);
