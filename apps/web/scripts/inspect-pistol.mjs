/** Renders the pistol stances (draw, one-handed hold, hip fire, aimed) → .tmp-rig/pistol.json. */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, Vector3 } from 'three';
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
const { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual } = await import('../src/game/render/weapons');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const vis = async (id, file, stance) => { const t = await raw(file), s = fittedSpec(builtinWeaponVisual(id), t); const L = (p) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
  return { ...standaloneVisual(id, s, t.root, template), attach: fitToHand(template, s, stance, t.root), spec: s, ...(s.muzzle ? { aim: { barrel: new Vector3(...s.barrel), up: new Vector3(...s.up), grip: L(s.grip) } } : {}), ...(s.support ? { twoHandGrip: { grip: L(s.grip), support: L(s.support), up: new Vector3(...s.up), triggerHand: 'right' } } : {}) }; };
const weapons = new Map([['ak47', await vis('ak47', 'models/weapons/ak47-rifle.bbmodel', 'rifle')], ['shotgun', await vis('shotgun', 'models/weapons/pump-shotgun.bbmodel', 'rifle')], ['gl18', await vis('gl18', 'models/weapons/glock-18.bbmodel', 'pistol')], ['grenade', await vis('grenade', 'models/weapons/frag-grenade.bbmodel', 'grenade')]]);
const G = EntityFlags.Grounded;
const states = [['draw .5s', .5, 0], ['draw 1.0s', 1, 0], ['draw 1.5s', 1.5, 0], ['hold', 3, 0], ['hip fire', 3, EntityFlags.Attacking], ['aimed', 3, EntityFlags.Aiming], ['aimed fire', 3, EntityFlags.Aiming | EntityFlags.Attacking]];
const out = [];
for (const [label, secs, extra] of states) {
  const av = new Avatar(template, true);
  av.setStance('pistol'); av.setWeapon('gl18', weapons);
  for (let t = 0; t < secs; t += 1 / 60) {
    const late = t > secs - .7;
    av.update(0, 0, 0, 0, G | (late ? extra : 0), 1 / 60, t); av.root.updateMatrixWorld(true);
  }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push(v.toArray()); const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray()); }
    meshes.push({ positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  out.push({ label, meshes });
}
await writeFile('.tmp-rig/pistol.json', JSON.stringify(out));
console.log('wrote', out.length);
