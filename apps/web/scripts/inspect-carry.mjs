/** Renders grenade carry/throw and in-game rifle ready poses to .tmp-rig/poses.json (render-raw.py --neg). */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from '../src/game/render/avatars';
import { BB_UNITS_PER_METER, buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';
import { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual } from '../src/game/render/weapons';
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const gT = await raw('models/weapons/frag-grenade.bbmodel'), gSpec = fittedSpec(builtinWeaponVisual('grenade'), gT);
const grenade = { ...standaloneVisual('grenade', gSpec, gT.root, template), attach: fitToHand(template, gSpec, 'grenade', gT.root) };
const rT = await raw('models/weapons/ak47-rifle.bbmodel'), rSpec = fittedSpec(builtinWeaponVisual('ak47'), rT);
const grip = new Vector3(...rSpec.grip).multiplyScalar(1 / BB_UNITS_PER_METER);
const rifle = { ...standaloneVisual('ak47', rSpec, rT.root, template), attach: fitToHand(template, rSpec, 'rifle', rT.root), spec: rSpec,
  aim: { barrel: new Vector3(...rSpec.barrel), up: new Vector3(...rSpec.up), grip },
  twoHandGrip: { grip, support: new Vector3(...rSpec.support).multiplyScalar(1 / BB_UNITS_PER_METER), up: new Vector3(...rSpec.up), triggerHand: 'right' } };
const G = EntityFlags.Grounded;

const states = [
  ['nade-idle', 'grenade', 0, 0, 60], ['nade-walk', 'grenade', -1.5, 0, 90],
  ['throw-25%', 'grenade', 0, EntityFlags.Attacking, 12], ['throw-45%', 'grenade', 0, EntityFlags.Attacking, 22],
  ['throw-60%', 'grenade', 0, EntityFlags.Attacking, 29], ['throw-80%', 'grenade', 0, EntityFlags.Attacking, 38],
  ['rifle-ready', 'rifle', 0, 0, 60], ['rifle-ready-walk', 'rifle', -2, 0, 90], ['rifle-hipfire', 'rifle', 0, EntityFlags.Attacking, 30],
];
const out = [];
for (const [label, stance, vz, flags, frames] of states) {
  const av = new Avatar(template, true);
  av.setStance(stance); av.setWeapon(stance === 'rifle' ? 'ak47' : 'grenade', new Map([[stance === 'rifle' ? 'ak47' : 'grenade', stance === 'rifle' ? rifle : grenade]]));
  for (let i = 0; i < 60; i++) { av.update(0, 0, 0, 0, G, 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  let z = 0;
  for (let i = 0; i < frames; i++) { z += vz / 60; av.update(0, 0, z, 0, G | (i < 3 ? flags : flags & ~EntityFlags.Attacking | (stance === 'rifle' ? flags : 0)), 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push(v.toArray());
      const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray());
    }
    meshes.push({ name: o.name, positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  out.push({ label, meshes });
}
await writeFile('.tmp-rig/poses.json', JSON.stringify(out));
console.log('wrote', out.length);
