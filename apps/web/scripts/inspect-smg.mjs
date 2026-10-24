/** Renders compact guns held in the lobby (relaxed idle) and in a match → .tmp-rig/smg.json. */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, Quaternion, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { untexturedGlb } from '../src/game/render/test-glb';
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  if (path.endsWith('manifest.json')) return new Response('', { status: 404 });
  const buf = await readFile(`apps/web/public${path}`);
  return new Response(path.endsWith('.glb') ? untexturedGlb(buf) : buf);
};
const { Avatar } = await import('../src/game/render/avatars');
const { BB_UNITS_PER_METER, buildBBModel, mirrorCharacter, survivorTemplate } = await import('../src/game/render/character-model');
const { parseHumanAssets } = await import('../src/game/render/human-rig');
const { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual, loadWeaponModel } = await import('../src/game/render/weapons');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const vis = async (id, file, stance) => { const t = file.endsWith('.glb') ? await loadWeaponModel(file) : await raw(file), s = fittedSpec(builtinWeaponVisual(id), t); const L = (p) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
  return { ...standaloneVisual(id, s, t.root, template), attach: fitToHand(template, s, stance, t.root), spec: s, ...(s.muzzle ? { aim: { barrel: new Vector3(...s.barrel), up: new Vector3(...s.up), grip: L(s.grip) } } : {}), ...(s.support ? { twoHandGrip: { grip: L(s.grip), support: L(s.support), up: new Vector3(...s.up), triggerHand: 'right' } } : {}) }; };
const weapons = new Map([['p90', await vis('p90', '/models/weapons/p90.glb', 'rifle')], ['ak47', await vis('ak47', 'models/weapons/ak47-rifle.bbmodel', 'rifle')]]);
const out = [];
for (const [label, item, idle, extra] of [['p90 lobby', 'p90', 'rifle_idle', 0], ['p90 game', 'p90', null, 0], ['p90 aim', 'p90', null, EntityFlags.Aiming], ['ak game', 'ak47', null, 0]]) {
  const av = new Avatar(template, true);
  av.setStance('rifle'); av.setWeapon(item, weapons); av.setMocapIdle(idle);
  for (let i = 0; i < 60; i++) { av.update(0, 0, 0, Math.PI, EntityFlags.Grounded | (extra ?? 0), 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  if (process.env.PROBE) {
    // Forward distance of the left arm's joints in front of the chest (negative: inside the body).
    const human = av.human, q = av.root.getWorldQuaternion(new Quaternion()), front = new Vector3(0, 0, -1).applyQuaternion(q);
    const chest = human.bonePosition('spine_002'), at = (n) => human.bonePosition(n).sub(chest);
    console.log(label, ['forearm_L', 'hand_L', 'hand_R'].map((n) => `${n} fwd ${at(n).dot(front).toFixed(3)} side ${at(n).dot(new Vector3(-front.z, 0, front.x)).toFixed(3)} y ${at(n).y.toFixed(3)}`).join(' | '));
  }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push(v.toArray()); const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray()); }
    const all = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
    // UPPER=1: only the chest, arms and gun, enlarged (the renderer frames what it is given).
    if (process.env.UPPER) {
      const keep = [], map = new Map(), P = [], C = [];
      for (let i = 0; i < all.length; i += 3) if ([0, 1, 2].every((k) => positions[all[i + k]][1] > 1.05)) keep.push(all[i], all[i + 1], all[i + 2]);
      const I = keep.map((j) => { if (!map.has(j)) { map.set(j, P.length); P.push(positions[j].map((v, k) => (k === 1 ? (v - 1.05) * 3 : v * 3))); C.push(colors[j]); } return map.get(j); });
      if (I.length) meshes.push({ positions: P, colors: C, indices: I });
    } else meshes.push({ positions, colors, indices: all });
  });
  out.push({ label, meshes });
}
await writeFile('.tmp-rig/smg.json', JSON.stringify(out));
console.log('wrote', out.length);
