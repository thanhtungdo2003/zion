/** Renders compact guns held in the lobby (relaxed idle) and in a match → .tmp-rig/smg.json. */
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
const { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual, loadWeaponModel } = await import('../src/game/render/weapons');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const vis = async (id, file, stance) => { const t = file.endsWith('.glb') ? await loadWeaponModel(file) : await raw(file), s = fittedSpec(builtinWeaponVisual(id), t); const L = (p) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
  return { ...standaloneVisual(id, s, t.root, template), attach: fitToHand(template, s, stance, t.root), spec: s, ...(s.muzzle ? { aim: { barrel: new Vector3(...s.barrel), up: new Vector3(...s.up), grip: L(s.grip) } } : {}), ...(s.support ? { twoHandGrip: { grip: L(s.grip), support: L(s.support), up: new Vector3(...s.up), triggerHand: 'right' } } : {}) }; };
const weapons = new Map([['p90', await vis('p90', '/models/weapons/p90.glb', 'rifle')], ['ak47', await vis('ak47', 'models/weapons/ak47-rifle.bbmodel', 'rifle')]]);
const out = [];
for (const [label, item, idle] of [['p90 lobby', 'p90', 'rifle_idle'], ['p90 game', 'p90', null], ['ak lobby', 'ak47', 'rifle_idle']]) {
  const av = new Avatar(template, true);
  av.setStance('rifle'); av.setWeapon(item, weapons); av.setMocapIdle(idle);
  for (let i = 0; i < 60; i++) { av.update(0, 0, 0, Math.PI, EntityFlags.Grounded, 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
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
await writeFile('.tmp-rig/smg.json', JSON.stringify(out));
console.log('wrote', out.length);
