// Apply the approved 4X construction to the remaining ModelGen optics.
// Keep existing atlases and mounts; replace rounded tube sections with exact octagons.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = path.join(root, 'models/accessorys');
const read = async name => JSON.parse(await fs.readFile(path.join(directory, `${name}.bbmodel`), 'utf8'));
const id = value => {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function faces(element) {
  if (element.box_uv === false && element.faces) return;
  const [x, y, z] = element.to.map((v, i) => Math.max(1, Math.round(v - element.from[i])));
  const [u, v] = element.uv_offset ?? [0, 0];
  const face = uv => ({ uv, texture: 0 });
  element.faces = {
    up: face([u + z, v, u + z + x, v + z]),
    down: face([u + z + x, v, u + z + 2 * x, v + z]),
    east: face([u, v + z, u + z, v + z + y]),
    north: face([u + z, v + z, u + z + x, v + z + y]),
    west: face([u + z + x, v + z, u + 2 * z + x, v + z + y]),
    south: face([u + 2 * z + x, v + z, u + 2 * z + 2 * x, v + z + y]),
  };
  element.box_uv = false;
}
function normalize(model) {
  const groups = new Map();
  for (const e of model.elements) {
    if (!e.name.includes(' panel ') || e.box_uv === false) continue;
    const key = e.name.split(' panel ')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const panels of groups.values()) for (let offset = 0; offset < panels.length; offset += 8) {
    const ring = panels.slice(offset, offset + 8);
    if (ring.length !== 8) throw new Error('Incomplete octagonal tube');
    const first = ring[0], radius = first.to[0], thickness = first.to[0] - first.from[0];
    const radial = radius - thickness / 2, halfWidth = radius * Math.tan(Math.PI / 8);
    const y = model.zion_attachment.eye[1];
    const z0 = first.from[2], z1 = first.to[2];
    ring.forEach((e, i) => {
      faces(e); // Preserve the original atlas allocation before changing dimensions.
      const angle = i * Math.PI / 4;
      const x = radial * Math.cos(angle), cy = y + radial * Math.sin(angle);
      e.origin = [x, cy, (z0 + z1) / 2];
      e.from = [x - thickness / 2, cy - halfWidth, z0];
      e.to = [x + thickness / 2, cy + halfWidth, z1];
      e.rotation = [0, 0, i * 45];
    });
  }
  // The four crossing rectangles form an octagonal aperture, like the approved 4X.
  const lenses = model.elements.filter(e => e.name.startsWith('lens:'));
  if (lenses.length && !lenses.some(e => e.name.includes(' bar '))) {
    const replacements = [];
    for (const kind of ['objective', 'ocular']) {
      const source = lenses.find(e => e.name === `lens:lens ${kind}`);
      if (!source) throw new Error(`Missing ${kind} lens`);
      const radius = (source.to[0] - source.from[0]) / 2;
      const [x, y] = model.zion_attachment.eye;
      const z = kind === 'ocular' ? model.zion_attachment.eye[2] : (source.from[2] + source.to[2]) / 2;
      for (let i = 0; i < 4; i++) {
        const e = structuredClone(source); faces(e);
        e.name = `lens:lens ${kind} bar ${i + 1}`; e.uuid = id(`${model.name}:${e.name}`);
        e.origin = [x, y, z]; e.rotation = [0, 0, i * 45];
        e.from = [x - radius, y - radius * Math.tan(Math.PI / 8), z - .128];
        e.to = [x + radius, y + radius * Math.tan(Math.PI / 8), z + .128];
        replacements.push(e);
      }
    }
    const old = new Set(lenses.map(e => e.uuid));
    const visit = groups => groups.forEach(g => {
      if (typeof g !== 'object') return;
      g.children = g.children.filter(c => !old.has(c));
      if (g.name === 'lens') g.children.push(...replacements.map(e => e.uuid));
      visit(g.children);
    });
    visit(model.outliner);
    model.elements = model.elements.filter(e => !old.has(e.uuid)).concat(replacements);
  }
  model.elements.forEach(faces);
}
const save = async (name, model) => {
  const data = JSON.stringify(model);
  await fs.writeFile(path.join(directory, `${name}.bbmodel`), data);
  await fs.writeFile(path.join(root, `apps/web/public/models/accessorys/${name}.bbmodel`), data);
};
for (const name of ['scope-2x-fixed', 'scope-8x40', 'nv-scope-x6', 'scope-pgo7']) {
  const model = await read(name); normalize(model); await save(name, model);
}
// A fixed-power 10x50: retain the 4X rail, turret and ocular construction, lengthen
// the optical body, and flare the objective to a 50 mm housing.
const ten = await read('scope-4x32');
ten.name = 'Scope 10x50'; ten.model_identifier = 'scope_10x50';
const remap = new Map();
const transform = (point, radial = 1) => [point[0] * radial, 12.16 + (point[1] - 12.16) * radial, point[2] * 1.25];
for (const e of ten.elements) {
  remap.set(e.uuid, id(`scope10:${e.uuid}`)); e.uuid = remap.get(e.uuid);
  const objective = /^(objective-|lens:lens objective)/.test(e.name);
  const radial = objective ? 1 + .5625 * Math.max(0, Math.min(1, (e.origin[2] - 20.8) / 11.2)) : 1;
  for (const key of ['from', 'to', 'origin']) e[key] = transform(e[key], radial);
}
const transformGroups = groups => groups.map(g => {
  if (typeof g === 'string') return remap.get(g);
  g.uuid = id(`scope10:${g.uuid}`); g.origin = transform(g.origin);
  g.children = transformGroups(g.children); return g;
});
ten.outliner = transformGroups(ten.outliner);
ten.zion_attachment.eye = transform(ten.zion_attachment.eye);
ten.zion_attachment.length *= 1.25; ten.zion_attachment.mountLength *= 1.25;
ten.zion_attachment.source = 'ZION / approved 4X construction';
await save('scope-10x', ten);
