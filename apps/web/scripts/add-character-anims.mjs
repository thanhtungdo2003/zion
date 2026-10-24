// Adds motion-capture clips (Mixamo FBX in models/characters/mocap/) to the survivor model
// (models/characters/zion-survivor.glb), retargeted to its Rigify skeleton:
//   - every bone is matched by direction in the two rest poses (Mixamo T-pose, the survivor's
//     A-pose), then turns exactly as the source bone turns in the world;
//   - clips stay on the spot: the hips' horizontal travel is removed (and measured: the distance
//     one loop covers, so the game can match the steps to the ground speed), their height kept
//     as an offset scaled to the survivor's hip height;
//   - written as glTF animations on the joint nodes; extras carry loop, stride and phase times.
// Usage: node scripts/add-character-anims.mjs   (run after prepare-character.mjs)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const root = path.resolve(import.meta.dirname, '../../..');
const glbPath = path.join(root, 'models/characters/zion-survivor.glb');
const mocapDir = path.join(root, 'models/characters/mocap');

/** Clip names, loop and how the game uses them (phases in seconds of the source clip). */
/** stride: metres one loop covers (these clips are recorded on the spot). */
const CLIPS = {
  fast_run: { loop: true, stride: 3.4, source: 'Fast Run.fbx' },
  rifle_sprint_forward: { loop: true, stride: 3, source: 'Sprint Forward.fbx' },
  rifle_sprint_backward: { loop: true, stride: 2.1, source: 'Sprint Backward.fbx' },
  rifle_start_run: { loop: false, source: 'Rifle Start Run.fbx' },
  rifle_idle: { loop: true, source: 'Rifle Idle.fbx' },
  rifle_aim_idle: { loop: true, source: 'Rifle Aiming Idle.fbx' },
  rifle_run: { loop: true, stride: 2.8, source: 'Rifle Run.fbx' },
  rifle_reload: { loop: false, source: 'Reloading.fbx' },
  run_left: { loop: true, stride: 2.4, source: 'Run Left.fbx' },
  run_right: { loop: true, stride: 2.4, source: 'Run Right.fbx' },
  rifle_kneel_idle: { loop: true, source: 'Rifle Kneel Idle.fbx' },
  // This firing pose is held at its first frame at rest; playback is reserved for firing.
  prone_rifle: { loop: true, source: 'Prone Firing Rifle.fbx' },
  // Crawl has a small net root drift, not a stride measurement. Preserve the recording's
  // cadence at the controller's normal prone speed instead of speeding it up from that drift.
  prone_forward: { loop: true, speed: 1.15, source: 'Prone Forward.fbx' },
  prone_turn_left: { loop: true, turn: true, source: 'Prone Left Turn.fbx' },
  crouch_forward: { loop: true, stride: 1.2, source: 'Crouch Walking.fbx' },
  crouch_backward: { loop: true, stride: 1.2, source: 'Walk Crouching Backward.fbx' },
  crouch_left: { loop: true, stride: 1.2, source: 'Walk Crouching Left.fbx' },
  crouch_right: { loop: true, stride: 1.2, source: 'Walk Crouching Right.fbx' },
  stand_to_crouch: { loop: false, source: 'Stand To Crouch.fbx' },
  crouch_to_prone: { loop: false, source: 'Crouch To Prone.fbx' },
  // Standing turns in place: limbs step, gameplay owns the heading (yaw removed like prone turns).
  turn_left: { loop: false, turn: 'standing', source: 'Left Turn.fbx' },
  turn_right: { loop: false, turn: 'standing', source: 'Right Turn.fbx' },
  // Ladder up/down cycles; the end of a climb onto a ledge.
  climb_up: { loop: true, source: 'Climbing Up Wall.fbx' },
  climb_down: { loop: true, source: 'Climbing Down Wall.fbx' },
  hang_to_crouch: { loop: false, source: 'Braced Hang To Crouch.fbx' },
  // Unarmed attacks, cycled.
  punch_1: { loop: false, source: 'Punching.fbx' },
  punch_2: { loop: false, source: 'Punching (1).fbx' },
  punch_hook: { loop: false, source: 'Right Hook.fbx' },
  // One-handed blade combo: outward slash, thrust, slash (both from Thrust Slash), lunging finisher.
  sword_slash: { loop: false, source: 'Stable Sword Outward Slash.fbx' },
  sword_thrust_slash: { loop: false, source: 'Thrust Slash.fbx' },
  sword_combo: { loop: false, source: 'comboslash.fbx' },
  // Pistol: drawing it from the hip (ends one-handed, the left hand free) and the two-handed firing stance.
  pistol_draw: { loop: false, source: 'Drawing Gun.fbx' },
  pistol_shoot: { loop: true, source: 'Shooting.fbx' },
  melee_walk: { loop: true, stride: 1.4 },
  roll: { loop: false },
  // Long-hafted weapons (the quắm): two slashes in turn; heavy blunt weapons (sledgehammer, bat): one swing.
  long_melee_slash: { loop: false, source: 'long-melee-slash.fbx' },
  long_melee_slash_2: { loop: false, source: 'long-melee-slash-2.fbx' },
  hammer: { loop: false, source: 'hammer.fbx' },
  // The dive roll with a weapon in hand (Running Dive Roll).
  roll_armed: { loop: false, source: 'Running Dive Roll.fbx' },
  jump: { loop: false },
};

const MAP = {
  Hips: 'spine', Spine: 'spine_001', Spine1: 'spine_002', Spine2: 'spine_003', Neck: 'spine_004', Head: 'spine_006',
  ...Object.fromEntries(['Left', 'Right'].flatMap((side) => {
    const s = side === 'Left' ? 'L' : 'R';
    return [
      [`${side}Shoulder`, `shoulder_${s}`], [`${side}Arm`, `upper_arm_${s}`], [`${side}ForeArm`, `forearm_${s}`], [`${side}Hand`, `hand_${s}`],
      [`${side}UpLeg`, `thigh_${s}`], [`${side}Leg`, `shin_${s}`], [`${side}Foot`, `foot_${s}`], [`${side}ToeBase`, `toe_${s}`],
      ...[['Thumb', 'thumb'], ['Index', 'f_index'], ['Middle', 'f_middle'], ['Ring', 'f_ring'], ['Pinky', 'f_pinky']].flatMap(([m, r]) => [1, 2, 3].map((k) => [`${side}Hand${m}${k}`, `${r}_0${k}_${s}`])),
    ];
  })),
};
const CHILD = (n) => ({ Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End' }[n]
  ?? n.replace(/^(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase)$/, (_, s, p) => s + { Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', Hand: 'HandMiddle1', UpLeg: 'Leg', Leg: 'Foot', Foot: 'ToeBase', ToeBase: 'Toe_End' }[p])
    .replace(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/, (_, s, f, k) => `${s}Hand${f}${+k + 1}`));
const clean = (n) => n.replace(/^.*:/, '').replace(/^mixamorig\d*_?/i, '');

// ---- the survivor's skeleton, from the GLB ----
const buf = readFileSync(glbPath), jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
let bin = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + buf.readUInt32LE(20 + jsonLen));
// Replace only animation data previously appended by this script. Geometry and skin bindings
// remain byte-identical, and rerunning the importer cannot keep growing the GLB.
if (gltf.animations?.length) {
  const firstAccessor = Math.min(...gltf.animations.flatMap((a) => a.samplers.flatMap((s) => [s.input, s.output])));
  const firstView = Math.min(...gltf.accessors.slice(firstAccessor).map((a) => a.bufferView));
  const offset = Math.min(...gltf.bufferViews.slice(firstView).map((v) => v.byteOffset ?? 0));
  if (gltf.meshes.some((m) => m.primitives.some((p) => [p.indices, ...Object.values(p.attributes)].some((a) => a >= firstAccessor)))) throw new Error('animation data overlaps geometry');
  gltf.accessors.length = firstAccessor; gltf.bufferViews.length = firstView;
  bin = bin.subarray(0, offset);
}
const joints = gltf.skins[0].joints, nodes = gltf.nodes;
const parent = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const local = joints.map((j) => ({ t: new THREE.Vector3(...(nodes[j].translation ?? [0, 0, 0])), q: new THREE.Quaternion(...(nodes[j].rotation ?? [0, 0, 0, 1])) }));
const jointOf = new Map(joints.map((j, k) => [j, k]));
const parentJ = joints.map((j) => (parent.has(j) ? jointOf.get(parent.get(j)) : -1));
const order = [];
{ const seen = new Set(); const visit = (k) => { if (seen.has(k)) return; if (parentJ[k] >= 0) visit(parentJ[k]); seen.add(k); order.push(k); }; joints.forEach((_, k) => visit(k)); }
const W = [], P = [];
for (const k of order) {
  const p = parentJ[k];
  W[k] = p >= 0 ? W[p].clone().multiply(local[k].q) : local[k].q.clone();
  P[k] = p >= 0 ? P[p].clone().add(local[k].t.clone().applyQuaternion(W[p])) : local[k].t.clone();
}
const byName = new Map(joints.map((j, k) => [nodes[j].name, k]));
const hipsK = byName.get('spine');
const restHipH = P[hipsK].y - Math.min(P[byName.get('foot_L')].y, P[byName.get('toe_L')].y);

// ---- retarget each clip ----
const worldQ = (o) => { const p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3(); o.matrixWorld.decompose(p, r, s); return r; };
const worldP = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
const out = [];
for (const file of readdirSync(mocapDir).filter((f) => f.endsWith('.fbx') && CLIPS[f.slice(0, -4)]).sort()) {
  const id = file.replace(/\.fbx$/, ''), spec = CLIPS[id] ?? { loop: false };
  const data = readFileSync(path.join(mocapDir, file));
  const src = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  const clip = src.animations[0];
  const bones = new Map();
  src.traverse((o) => { if (o.isBone || /mixamorig/i.test(o.name)) bones.set(clean(o.name), o); });
  src.updateMatrixWorld(true);
  const pairs = Object.entries(MAP).filter(([s, t]) => bones.has(s) && byName.has(t));
  const hipsRest = worldP(bones.get('Hips'));
  const footY = Math.min(...['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((n) => worldP(bones.get(n)).y));
  const scale = restHipH / (hipsRest.y - footY);
  const offset = new Map();
  for (const [s, t] of pairs) {
    const k = byName.get(t), child = bones.get(CHILD(s));
    let aligned = W[k].clone();
    if (child) {
      const sDir = worldP(child).sub(worldP(bones.get(s))).normalize(), tDir = new THREE.Vector3(0, 1, 0).applyQuaternion(W[k]);
      aligned = new THREE.Quaternion().setFromUnitVectors(tDir, sDir).multiply(W[k]);
    }
    offset.set(k, worldQ(bones.get(s)).invert().multiply(aligned));
  }
  const mixer = new THREE.AnimationMixer(src);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const frames = Math.max(2, Math.round(clip.duration * 30) + 1), times = [];
  const rot = joints.map(() => []), hipsY = [], travel = [];
  const world = [];
  for (let f = 0; f < frames; f++) {
    const t = clip.duration * f / (frames - 1);
    times.push(t);
    mixer.setTime(t); src.updateMatrixWorld(true);
    const target = new Map(pairs.map(([s, tn]) => [byName.get(tn), worldQ(bones.get(s)).multiply(offset.get(byName.get(tn)))]));
    if (spec.turn) {
      // Gameplay owns heading. Keep the turn's limb motion but remove its accumulated yaw,
      // otherwise the root and the recorded pelvis would turn the character twice.
      // In prone, the pelvis' local forward axis points almost vertically. Its projected yaw
      // becomes singular. The hip-to-chest axis stays horizontal and gives a stable heading.
      // Standing, that axis is nearly vertical; the pelvis' own forward axis is level instead.
      const forward = spec.turn === 'standing' ? new THREE.Vector3(0, 0, 1).applyQuaternion(worldQ(bones.get('Hips')))
        : worldP(bones.get('Spine2')).sub(worldP(bones.get('Hips')));
      const heading = Math.atan2(forward.x, forward.z);
      const unturn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
      for (const q of target.values()) q.premultiply(unturn);
    }
    for (const k of order) {
      const p = parentJ[k], pq = p >= 0 ? world[p] : new THREE.Quaternion();
      world[k] = target.get(k) ?? pq.clone().multiply(local[k].q);
      const q = pq.clone().invert().multiply(world[k]).normalize();
      const prev = rot[k].length ? rot[k].slice(-4) : null;
      if (prev && q.x * prev[0] + q.y * prev[1] + q.z * prev[2] + q.w * prev[3] < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      rot[k].push(q.x, q.y, q.z, q.w);
    }
    const d = worldP(bones.get('Hips')).sub(hipsRest).multiplyScalar(scale);
    hipsY.push(d.y); travel.push(d);
  }
  // Ground one loop covers (the game plays a loop once per this many metres travelled).
  const covered = Math.hypot(travel.at(-1).x - travel[0].x, travel.at(-1).z - travel[0].z);
  const stride = spec.speed ? spec.speed * clip.duration : covered > .2 ? covered : spec.stride ?? 1.5;
  const moving = rot.map((r, k) => r.some((v, i) => Math.abs(v - [local[k].q.x, local[k].q.y, local[k].q.z, local[k].q.w][i % 4]) > 1e-4));
  // Forward (+Z) travel per frame (model metres): one-shot moves such as a lunge replay it.
  const forward = travel.map((d) => +(d.z - travel[0].z).toFixed(4));
  out.push({ id, loop: spec.loop, times, rot, moving, hipsY, forward, stride: +stride.toFixed(3), source: spec.source ?? file, sha256: createHash('sha256').update(data).digest('hex') });
  console.log(`${id}: ${clip.duration.toFixed(2)} s, ${frames} frames, ${pairs.length} bones mapped, travel ${covered.toFixed(2)} m, hips y ${Math.min(...hipsY).toFixed(2)}…${Math.max(...hipsY).toFixed(2)}`);
}

// Derive the right crawl turn by reflecting rest-relative world rotations and swapping sides.
// Reflecting local quaternion components alone would twist the asymmetric Rigify rest pose.
const leftTurn = out.find((c) => c.id === 'prone_turn_left');
if (leftTurn) {
  const rot = joints.map(() => []);
  const mirror = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
  for (let f = 0; f < leftTurn.times.length; f++) {
    const sourceWorld = [], targetWorld = [];
    for (const k of order) {
      const p = parentJ[k];
      sourceWorld[k] = (p >= 0 ? sourceWorld[p] : new THREE.Quaternion()).clone().multiply(new THREE.Quaternion().fromArray(leftTurn.rot[k], f * 4));
    }
    for (const k of order) {
      const name = nodes[joints[k]].name.replace(/_([LR])(?=_|$)/g, (_, side) => `_${side === 'L' ? 'R' : 'L'}`);
      const other = byName.get(name) ?? k, p = parentJ[k];
      targetWorld[k] = mirror(sourceWorld[other].clone().multiply(W[other].clone().invert())).multiply(W[k]);
      const q = (p >= 0 ? targetWorld[p] : new THREE.Quaternion()).clone().invert().multiply(targetWorld[k]).normalize();
      const prev = rot[k].slice(-4);
      if (prev.length && q.dot(new THREE.Quaternion(...prev)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      rot[k].push(...q.toArray());
    }
  }
  out.push({ ...leftTurn, id: 'prone_turn_right', rot, moving: rot.map(() => true), derived: 'mirror-x:prone_turn_left' });
}

// ---- write them into the GLB ----
const chunks = [bin];
let length = bin.length;
const addAccessor = (arr, type, minmax) => {
  const pad = (4 - (length % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
  const data = Buffer.from(new Float32Array(arr).buffer);
  gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
  chunks.push(data); length += data.length;
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const acc = { bufferView: gltf.bufferViews.length - 1, componentType: 5126, count: arr.length / n, type };
  if (minmax) { acc.min = [Math.min(...arr)]; acc.max = [Math.max(...arr)]; }
  gltf.accessors.push(acc);
  return gltf.accessors.length - 1;
};
gltf.animations = out.map((c) => {
  const input = addAccessor(c.times, 'SCALAR', true), samplers = [], channels = [];
  c.rot.forEach((r, k) => {
    if (!c.moving[k]) return;
    samplers.push({ input, output: addAccessor(r, 'VEC4'), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: joints[k], path: 'rotation' } });
  });
  return { name: c.id, samplers, channels, extras: { loop: c.loop, hipsY: c.hipsY.map((v) => +v.toFixed(4)), ...(c.loop ? {} : { forward: c.forward }), stride: c.stride, source: c.source, sha256: c.sha256, derived: c.derived, retarget: 'rigify-fixed-bind-v2' } };
});
bin = Buffer.concat(chunks);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
gltf.buffers[0].byteLength = binPadded.length;
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4);
const file = Buffer.concat([header, jh, json, bh, binPadded]);
writeFileSync(glbPath, file);
console.log(`${path.relative(root, glbPath)}: ${(file.length / 1048576).toFixed(2)} MB, ${out.length} clips`);
