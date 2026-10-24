// Converts a skinned low-poly character GLB (Mixamo-like rig: hips, spine, chest, neck, head,
// shoulder/arm/forearm/hand, upleg/leg/foot/toe) into the game's character rig:
//   root > body > { head, arm_left > hand_left, arm_right > hand_right, back_attach }, leg_left, leg_right
// The mesh is posed by the file's first animation frame (a standing pose), skinned on the CPU,
// split per game bone (each triangle goes to the bone with the most weight) and scaled to 1.8 m.
// Usage: node scripts/convert-character-glb.mjs <in.glb> <out.json> [--strip-armor]
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) { console.error('usage: convert-character-glb <in.glb> <out.json> [--strip-armor]'); process.exit(1); }
const stripArmor = flags.includes('--strip-armor');

const buf = readFileSync(input), jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = buf.subarray(20 + jsonLen + 8);
const read = (i) => {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
  const get = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5121: (o) => bin.readUInt8(o) }[a.componentType];
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? n * size, out = [];
  for (let k = 0; k < a.count; k++) { const row = []; for (let c = 0; c < n; c++) row.push(get(base + k * stride + c * size)); out.push(row); }
  return out;
};

// Node transforms, posed by the first key of the first animation.
const nodes = gltf.nodes.map((n) => ({ ...n, t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
for (const ch of gltf.animations?.[0]?.channels ?? []) {
  const s = gltf.animations[0].samplers[ch.sampler], v = read(s.output)[0], n = nodes[ch.target.node];
  if (ch.target.path === 'translation') n.t = v; else if (ch.target.path === 'rotation') n.r = v; else if (ch.target.path === 'scale') n.s = v;
}
const parent = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const local = (n) => n.matrix && !gltf.animations?.[0]?.channels.some((c) => nodes[c.target.node] === n)
  ? new Matrix4().fromArray(n.matrix)
  : new Matrix4().compose(new Vector3(...n.t), new Quaternion(...n.r), new Vector3(...n.s));
const worldCache = new Map();
const world = (i) => {
  if (!worldCache.has(i)) { const p = parent.get(i); worldCache.set(i, p === undefined ? local(nodes[i]) : world(p).clone().multiply(local(nodes[i]))); }
  return worldCache.get(i);
};

const skin = gltf.skins[0], jointNames = skin.joints.map((i) => nodes[i].name.replace(/_\d+$/, ''));
const ibm = read(skin.inverseBindMatrices).map((m) => new Matrix4().fromArray(m));
// Sketchfab FBX exports keep the joints in mesh units while the inverse bind matrices carry the
// FBX unit scale (bind joints scaled by 1/k): undo that scale after skinning.
const bindScale = Math.max(...ibm.map((m) => new Vector3().setFromMatrixScale(m).x));
const jointMat = skin.joints.map((j, k) => new Matrix4().makeScale(1 / bindScale, 1 / bindScale, 1 / bindScale).multiply(world(j)).multiply(ibm[k]));
// Rig mapping.
const GAME_OF = (name) => {
  const side = /\.R\b|\.R_/.test(name) || name.endsWith('.R') ? 'right' : /\.L\b|\.L_/.test(name) || name.endsWith('.L') ? 'left' : '';
  if (/^(hips|spine|chest|shoulder)/.test(name)) return 'body';
  if (/^(neck|head)/.test(name)) return 'head';
  if (/^(arm|forearm)/.test(name)) return `arm_${side}`;
  if (/^(hand|thumb|index|middle|ring|pinky)/.test(name)) return `hand_${side}`;
  if (/^(upleg|leg|foot|toe)/.test(name)) return `leg_${side}`;
  return 'body';
};
// Joints in the bind pose (the mesh as stored, arms out in a T), in mesh units.
const bindPos = (name) => { const k = jointNames.indexOf(name); return new Vector3().setFromMatrixPosition(ibm[k].clone().invert()).multiplyScalar(bindScale); };
void jointMat;
// Arms come down from the T: each arm (with its hand) turns about its shoulder to hang 8° out from the body.
const armTurn = {};
for (const [side, s] of [['right', 'R'], ['left', 'L']]) {
  const from = bindPos(`hand.${s}`).sub(bindPos(`arm.${s}`)).normalize(), out = Math.sign(from.x) * Math.sin(8 * Math.PI / 180);
  armTurn[side] = { pivot: bindPos(`arm.${s}`), q: new Quaternion().setFromUnitVectors(from, new Vector3(out, -Math.cos(8 * Math.PI / 180), 0).normalize()) };
}
const pose = (bone, v) => { const t = armTurn[bone.split('_')[1]]; return t && /^(arm|hand)_/.test(bone) ? v.clone().sub(t.pivot).applyQuaternion(t.q).add(t.pivot) : v; };
const jointPos = (name) => { const v = bindPos(name), g = GAME_OF(name); return pose(g, v); };

if (process.env.DEBUG) skin.joints.forEach((j, k) => { const m = jointMat[k], sc = new Vector3().setFromMatrixScale(m), t = new Vector3().setFromMatrixPosition(m); console.error(jointNames[k], sc.toArray().map((x) => x.toFixed(2)).join(','), t.toArray().map((x) => x.toFixed(0)).join(',')); });
const jointGame = jointNames.map(GAME_OF);

// Skin every character mesh (meshes skinned to the rig, minus the props held in the hands).
const tris = []; // {bone, color, p:[V3,V3,V3], n:[V3,V3,V3]}
let stripped = 0;
gltf.nodes.forEach((node) => {
  if (node.mesh === undefined || node.skin === undefined) return;
  const mesh = gltf.meshes[node.mesh];
  if (/^M4/i.test(mesh.name)) return; // the rifle and its magazine: the game holds its own weapons
  for (const prim of mesh.primitives) {
    const mat = gltf.materials[prim.material]?.pbrMetallicRoughness?.baseColorFactor ?? [.6, .6, .6, 1];
    const P = read(prim.attributes.POSITION), N = read(prim.attributes.NORMAL), J = read(prim.attributes.JOINTS_0), W = read(prim.attributes.WEIGHTS_0);
    const idx = prim.indices !== undefined ? read(prim.indices).map((r) => r[0]) : P.map((_, i) => i);
    const pos = [], nrm = [], dom = [];
    for (let i = 0; i < P.length; i++) {
      const m = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), e = m.elements;
      const weight = new Map();
      for (let c = 0; c < 4; c++) {
        const w = W[i][c]; if (!w) continue;
        const je = jointMat[J[i][c]].elements;
        for (let k = 0; k < 16; k++) e[k] += je[k] * w;
        const g = jointGame[J[i][c]]; weight.set(g, (weight.get(g) ?? 0) + w);
      }
      pos.push(new Vector3(...P[i]));
      nrm.push(new Vector3(...N[i]).normalize());
      dom.push({ weight, joint: jointNames[J[i][W[i].indexOf(Math.max(...W[i]))]] });
    }
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]], sum = new Map();
      for (const k of v) for (const [g, w] of dom[k].weight) sum.set(g, (sum.get(g) ?? 0) + w);
      const bone = [...sum].sort((a, b) => b[1] - a[1])[0][0];
      // Armour: the black and grey vest pieces on the torso (straps, plates, pouches).
      if (stripArmor && /Material\.00[14]/.test(mesh.name) && v.every((k) => /^(hips|spine|chest|shoulder)/.test(dom[k].joint))) { stripped++; continue; }
      const at = armTurn[bone.split('_')[1]], turn = at && /^(arm|hand)_/.test(bone);
      tris.push({ bone, material: gltf.materials[prim.material]?.name ?? 'material', color: mat.slice(0, 3), p: v.map((k) => pose(bone, pos[k])), n: v.map((k) => (turn ? nrm[k].clone().applyQuaternion(at.q) : nrm[k])) });
    }
  }
});

// Frame: +Y up, feet on y = 0, centred on the hips, facing −Z, scaled to 1.8 m.
const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
for (const t of tris) for (const p of t.p) { min.min(p); max.max(p); }
const hips = jointPos('hips');
const forward = jointPos('toe.L').sub(jointPos('foot.L')).add(jointPos('toe.R').sub(jointPos('foot.R'))).setY(0).normalize();
const turn = new Matrix4().makeRotationY(Math.atan2(forward.x, forward.z) - Math.PI); // forward → −Z
const scale = 1.8 / (max.y - min.y);
const frame = new Matrix4().makeScale(scale, scale, scale).multiply(turn).multiply(new Matrix4().makeTranslation(-hips.x, -min.y, -hips.z));
const F = (v) => v.clone().applyMatrix4(frame);
const FN = (v) => v.clone().transformDirection(turn);
const piv = (name) => F(jointPos(name));

const right = piv('arm.R');
if (right.x < 0) console.warn('warning: the right arm ends up on −X; check the rig names');
const pivots = {
  root: new Vector3(0, 0, 0),
  body: piv('spine'),
  head: piv('neck'),
  arm_right: piv('arm.R'), hand_right: piv('hand.R'),
  arm_left: piv('arm.L'), hand_left: piv('hand.L'),
  leg_right: piv('upleg.R'), leg_left: piv('upleg.L'),
};
const chest = piv('chest');
pivots.back_attach = new Vector3(0, chest.y, chest.z + .12);
const PARENT = { root: null, body: 'root', head: 'body', back_attach: 'body', arm_right: 'body', hand_right: 'arm_right', arm_left: 'body', hand_left: 'arm_left', leg_right: 'root', leg_left: 'root' };

if (process.env.DEBUG) console.error("dbg hips",hips.toArray().map(v=>v.toFixed(1)),"min",min.toArray().map(v=>v.toFixed(1)),"max",max.toArray().map(v=>v.toFixed(1)),"armR",jointPos("arm.R").toArray().map(v=>v.toFixed(1)),"handR",jointPos("hand.R").toArray().map(v=>v.toFixed(1)),"head",jointPos("head").toArray().map(v=>v.toFixed(1)));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const meshes = new Map();
for (const t of tris) {
  // One mesh per bone and material: a region the outfit studio can recolour or hide.
  const key = `${t.bone}|${t.material}`;
  if (!meshes.has(key)) meshes.set(key, { bone: t.bone, region: key, pos: [], nrm: [], col: [] });
  const m = meshes.get(key), o = pivots[t.bone];
  for (let k = 0; k < 3; k++) {
    const p = F(t.p[k]).sub(o), n = FN(t.n[k]);
    m.pos.push(r4(p.x), r4(p.y), r4(p.z)); m.nrm.push(r4(n.x), r4(n.y), r4(n.z)); m.col.push(r4(t.color[0]), r4(t.color[1]), r4(t.color[2]));
  }
}
const out = {
  format: 'zion-character@1',
  credit: gltf.asset?.extras ? `${gltf.asset.extras.title} by ${gltf.asset.extras.author}, ${gltf.asset.extras.license}` : '',
  height: 1.8,
  bones: Object.entries(PARENT).map(([name, p]) => ({ name, parent: p, pivot: [r4(pivots[name].x), r4(pivots[name].y), r4(pivots[name].z)] })),
  meshes: [...meshes.values()],
};
writeFileSync(output, JSON.stringify(out));
console.log(`ok: ${tris.length} triangles (${stripped} armour triangles removed), ${meshes.size} bone meshes, right arm x=${right.x.toFixed(2)} → ${output}`);
