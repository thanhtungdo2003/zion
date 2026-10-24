/** Renders melee, combo, punch, climb, turn and travel-facing poses to .tmp-rig/poses.json
 * (python apps/web/scripts/render-raw.py .tmp-rig/poses.json out.png --neg). */
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
const kT = await raw('models/weapons/katana.bbmodel'), kS = fittedSpec(builtinWeaponVisual('katana'), kT);
const L = (p) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
const katana = { ...standaloneVisual('katana', kS, kT.root, template), attach: fitToHand(template, kS, 'melee', kT.root),
  melee: { held: { axis: new Vector3(...kS.barrel).normalize(), edge: new Vector3(...kS.edge), grip: L(kS.grip), tip: L(kS.strikePoint) } } };
const rT = await raw('models/weapons/ak47-rifle.bbmodel'), rS = fittedSpec(builtinWeaponVisual('ak47'), rT);
const rifle = { ...standaloneVisual('ak47', rS, rT.root, template), attach: fitToHand(template, rS, 'rifle', rT.root), spec: rS,
  aim: { barrel: new Vector3(...rS.barrel), up: new Vector3(...rS.up), grip: L(rS.grip) },
  twoHandGrip: { grip: L(rS.grip), support: L(rS.support), up: new Vector3(...rS.up), triggerHand: 'right' } };
const G = EntityFlags.Grounded;
const arm = (av, kind) => {
  if (kind === 'katana') { av.setStance('melee'); av.setWeapon('katana', new Map([['katana', katana]])); }
  if (kind === 'rifle') { av.setStance('rifle'); av.setWeapon('ak47', new Map([['ak47', rifle]])); }
};
const run = (av, n, f) => { for (let i = 0; i < n; i++) { f(i); av.root.updateMatrixWorld(true); } };
const states = {
  'sword-idle': (av) => { arm(av, 'katana'); run(av, 60, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); },
  'sword-run-side': (av) => { arm(av, 'katana'); let x = 0; run(av, 90, () => av.update(x += 5 / 60, 0, 0, 0, G | EntityFlags.Sprinting, 1 / 60, 0)); },
  ...Object.fromEntries([0, 1, 2, 3].map((step) => [`combo-${step + 1}`, (av) => {
    arm(av, 'katana'); run(av, 30, () => av.update(0, 0, 0, 0, G, 1 / 60, 0));
    av.slash(step); const hit = [.34, .28, .16, .46][step]; let z = 0;
    run(av, Math.round(hit * 60), () => av.update(0, 0, step === 3 ? z -= 6.8 / 60 : 0, 0, G | EntityFlags.Attacking, 1 / 60, 0));
  }])),
  ...Object.fromEntries([[1, .1], [1, .25], [1, .45], [2, .1], [2, .3]].map(([step, t]) => [`seq-${step + 1}-${t}`, (av) => {
    arm(av, 'katana'); run(av, 30, () => av.update(0, 0, 0, 0, G, 1 / 60, 0));
    av.slash(step); run(av, Math.round(t * 60), () => av.update(0, 0, 0, 0, G | EntityFlags.Attacking, 1 / 60, 0));
  }])),
  'rifle-ready': (av) => { arm(av, 'rifle'); run(av, 60, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); },
  'unarmed-walk-back': (av) => { let z = 0; run(av, 90, () => av.update(0, 0, z += 2.5 / 60, 0, G, 1 / 60, 0)); },
  'turn-mid': (av) => { arm(av, 'rifle'); run(av, 30, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); run(av, 14, () => av.update(0, 0, 0, 1.2, G, 1 / 60, 0)); },
  'creator': (av) => { av.rigid = true; let y = 0; run(av, 90, () => av.update(0, 0, 0, y += .01, G, 1 / 60, 0)); },
  'menu-lobby': (av) => { arm(av, 'rifle'); av.setMocapIdle('rifle_idle'); run(av, 90, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); },
  'punch': (av) => { run(av, 30, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); run(av, 18, (i) => av.update(0, 0, 0, 0, G | EntityFlags.Attacking, 1 / 60, 0)); },
  'unarmed-run': (av) => { let z = 0; run(av, 90, () => av.update(0, 0, z -= 5.5 / 60, 0, G | EntityFlags.Sprinting, 1 / 60, 0)); },
  'gun-sprint': (av) => { arm(av, 'rifle'); let z = 0; run(av, 90, () => av.update(0, 0, z -= 5.9 / 60, 0, G | EntityFlags.Sprinting, 1 / 60, 0)); },
  'gun-walk-back': (av) => { arm(av, 'rifle'); let z = 0; run(av, 90, () => av.update(0, 0, z += 2.5 / 60, 0, G, 1 / 60, 0)); },
  'turn-in-place': (av) => { let yaw = 0; run(av, 30, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); run(av, 40, () => av.update(0, 0, 0, yaw += 3 / 60, G, 1 / 60, 0)); },
  'ladder-up': (av) => { let y = 0; run(av, 50, () => av.update(0, y += 2.4 / 60, 0, 0, EntityFlags.Climbing, 1 / 60, 0)); },
  'mantle-40%': (av) => { run(av, 10, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); av.poseMantle({ left: new Vector3(-.3, 1.6, -.5), right: new Vector3(.3, 1.6, -.5) }, .4); av.update(0, .5, 0, 0, EntityFlags.Mantling, 1 / 60, 0); av.poseMantle({ left: new Vector3(-.3, 1.6, -.5), right: new Vector3(.3, 1.6, -.5) }, .4); av.root.updateMatrixWorld(true); },
  'mantle-85%': (av) => { run(av, 10, () => av.update(0, 0, 0, 0, G, 1 / 60, 0)); av.update(0, 1.2, 0, 0, EntityFlags.Mantling, 1 / 60, 0); av.poseMantle({ left: new Vector3(-.3, 1.6, -.5), right: new Vector3(.3, 1.6, -.5) }, .85); av.root.updateMatrixWorld(true); },
};
const only = process.argv.slice(2);
const out = [];
for (const [label, setup] of Object.entries(states)) {
  if (only.length && !only.includes(label)) continue;
  const av = new Avatar(template, true); setup(av);
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
  out.push({ label: `${label} ${av.mocap?.clip ?? ''}`, meshes });
}
await writeFile('.tmp-rig/poses.json', JSON.stringify(out));
console.log('wrote', out.map((o) => o.label).join(' | '));
