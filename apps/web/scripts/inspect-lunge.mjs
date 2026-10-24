/** Blade finisher lunge: the root moves by the physics profile; prints each foot's speed (a planted foot ≈ 0). */
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
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
const { DEFAULT_CHARACTER } = await import('@zion/physics');
const weapons = new Map([['katana', await vis('katana', 'models/weapons/katana.bbmodel', 'melee')]]);
const av = new Avatar(template, true);
av.setStance('melee'); av.setWeapon('katana', weapons);
for (let i = 0; i < 30; i++) { av.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
av.slash(3);
const prof = DEFAULT_CHARACTER.lungeProfile, at = (t) => { const f = Math.min(prof.length - 1, t * 30), i = Math.floor(f), j = Math.min(prof.length - 1, i + 1); return prof[i] + (prof[j] - prof[i]) * (f - i); };
const foot = (n) => av.root.getObjectByName(n)?.getWorldPosition(new Vector3());
let prev = null;
const rows = [];
for (let k = 0; k <= 84; k++) {
  const t = k / 60, z = -at(t);
  av.update(0, 0, z, 0, EntityFlags.Grounded | (t < 1.3 ? EntityFlags.Attacking : 0), 1 / 60, 1 + t); av.root.updateMatrixWorld(true);
  const L = foot('foot_L'), R = foot('foot_R');
  if (prev) rows.push([t.toFixed(2), (-z).toFixed(2), ((L.z - prev[0].z) * 60).toFixed(2), ((R.z - prev[1].z) * 60).toFixed(2), L.y.toFixed(2), R.y.toFixed(2), av.mocap?.clip]);
  prev = [L, R];
}
console.log('t  travelled  footL m/s  footR m/s  clip');
for (const r of rows.filter((_, i) => i % 3 === 0)) console.log(r.join('  '));
