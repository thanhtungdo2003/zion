/** First-person hands for empty hands and a katana (idle, running, swinging) → .tmp-rig/poses-fp.json
 * (python apps/web/scripts/render-rig.py --first-person). */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, PerspectiveCamera, SkinnedMesh, Vector3 } from 'three';
import { BB_UNITS_PER_METER, buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';
import { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual } from '../src/game/render/weapons';
import { ViewModel } from '../src/game/render/viewmodel';
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const kT = await raw('models/weapons/katana.bbmodel'), kS = fittedSpec(builtinWeaponVisual('katana'), kT);
const L = (p) => new Vector3(...p).multiplyScalar(1 / BB_UNITS_PER_METER);
const katana = { ...standaloneVisual('katana', kS, kT.root, template), attach: fitToHand(template, kS, 'melee', kT.root),
  melee: { held: { axis: new Vector3(...kS.barrel).normalize(), edge: new Vector3(...kS.edge), grip: L(kS.grip), tip: L(kS.strikePoint) } } };
katana.melee.display = katana.melee.held;
const states = [
  ['empty-idle', null, false, 60], ['empty-run-a', null, true, 50], ['empty-run-b', null, true, 61],
  ['katana-idle', 'katana', false, 60], ['katana-run', 'katana', true, 55], ['katana-swing', 'katana', false, 60, true],
];
const out = [];
for (const [label, item, moving, frames, swing] of states) {
  const camera = new PerspectiveCamera(75, 1, .02, 100), view = new ViewModel(camera);
  view.setBody(human); view.set(item, item ? new Map([[item, katana]]) : null);
  for (let i = 0; i < frames; i++) {
    if (swing && i === frames - 10) view.swing(0);
    view.update(1 / 60, { visible: true, moving, sprint: moving, reloading: false, yaw: 0, pitch: 0 });
    camera.updateMatrixWorld(true);
  }
  camera.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const meshes = [];
  camera.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); positions.push(v.toArray());
      const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray());
    }
    meshes.push({ name: o.name, positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  const hl = camera.getObjectByName('hand_L'); if (hl) { const v = camera.worldToLocal(hl.getWorldPosition(new Vector3())); console.log(label, 'left hand angle x', (Math.atan2(v.x, -v.z) * 57.3).toFixed(1), 'y', (Math.atan2(v.y, -v.z) * 57.3).toFixed(1)); }
  out.push({ label, meshes });
  view.dispose();
}
await writeFile('.tmp-rig/poses-fp.json', JSON.stringify(out));
console.log('wrote', out.length);
