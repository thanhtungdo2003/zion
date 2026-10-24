/** Renders one ordinary zombie walking, running and screaming (frames over time) → .tmp-rig/zclips.json for render-raw.py. */
import fs from 'node:fs/promises';
import { Color, Mesh, SkinnedMesh, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
globalThis.fetch = async (url) => new Response(await fs.readFile(`models${String(url).slice('/models'.length)}`));
const { parseZombieModel, ZOMBIE_MODEL_URLS } = await import('../src/game/render/zombie-model.ts');
const { untexturedGlb } = await import('../src/game/render/test-glb.ts');
const { ZombieAvatar } = await import('../src/game/render/zombie-avatar.ts');
const { loadZombieClips } = await import('../src/game/render/zombie-clips.ts');
await loadZombieClips();
const which = Number(process.env.SKIN ?? 0);
const template = await parseZombieModel(untexturedGlb(await fs.readFile(`models${ZOMBIE_MODEL_URLS[which].slice('/models'.length)}`)));
const out = [];
for (const [label, speed, flags, at] of [['walk .3s', 1.1, 0, .3], ['walk .9s', 1.1, 0, .9], ['walk 1.5s', 1.1, 0, 1.5], ['run .15s', 4.5, EntityFlags.Sprinting, .15], ['run .4s', 4.5, EntityFlags.Sprinting, .4], ['scream .8s', 0, EntityFlags.Screaming, .8], ['scream 1.6s', 0, EntityFlags.Screaming, 1.6]]) {
  const a = new ZombieAvatar(template, () => {}, 1, 0, 3);
  a.seen = true; a.ground = () => 0;
  let z = 0;
  for (let t = 0; t < at; t += 1 / 60) { z -= speed / 60; a.update(0, 0, z, 0, EntityFlags.Grounded | flags, 0, 1 / 60); }
  a.root.updateMatrixWorld(true);
  a.root.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const meshes = [];
  a.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, positions = [], colors = [], v = new Vector3(), c = new Color(.55, .65, .45);
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(a.root.position); positions.push(v.toArray()); colors.push(c.toArray()); }
    meshes.push({ positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  out.push({ label, meshes });
}
await fs.writeFile('.tmp-rig/zclips.json', JSON.stringify(out));
console.log('wrote', out.length);
