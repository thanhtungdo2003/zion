import type { ModelDoc, ModelNode, Transform } from './doc';
import { primitiveMesh, roofMesh, rockMesh, slabParts, stairsDesign, stairsMesh, wallMesh, type MeshData, type MeshPart } from './mesh';

/** Column-major 4×4 matrix (as glTF and three.js store them). */
export type Mat4 = Float64Array;

export function identity(): Mat4 { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

/** T · R · S with the rotation as XYZ Euler angles (three.js's default order). */
export function composeTransform(t: Transform): Mat4 {
  const [ax, ay, az] = t.rotation, [sx, sy, sz] = t.scale;
  const a = Math.cos(ax), b = Math.sin(ax), c = Math.cos(ay), d = Math.sin(ay), e = Math.cos(az), f = Math.sin(az);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = new Float64Array(16);
  // Rotation (XYZ), as Matrix4.makeRotationFromEuler.
  m[0] = c * e; m[4] = -c * f; m[8] = d;
  m[1] = af + be * d; m[5] = ae - bf * d; m[9] = -b * c;
  m[2] = bf - ae * d; m[6] = be + af * d; m[10] = a * c;
  for (let i = 0; i < 3; i++) { m[i] *= sx; m[4 + i] *= sy; m[8 + i] *= sz; }
  m[12] = t.position[0]; m[13] = t.position[1]; m[14] = t.position[2]; m[15] = 1;
  return m;
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

/** Model-space matrix of every node (parents applied). */
export function worldMatrices(doc: ModelDoc): Map<string, Mat4> {
  const out = new Map<string, Mat4>(), byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const resolve = (n: ModelNode, depth = 0): Mat4 => {
    const hit = out.get(n.id);
    if (hit) return hit;
    const local = composeTransform(n.transform);
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const m = parent && depth < 64 ? multiply(resolve(parent, depth + 1), local) : local;
    out.set(n.id, m);
    return m;
  };
  for (const n of doc.nodes) resolve(n);
  return out;
}

/** Whether the node and all its parents are shown. */
export function effectiveVisible(doc: ModelDoc, id: string): boolean {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (let at = byId.get(id), i = 0; at && i < 64; at = at.parent ? byId.get(at.parent) : undefined, i++) if (at.visible === false) return false;
  return true;
}

/** The meshes a procedural node is made of, in its own space, each with its material id. */
export function nodeMeshes(n: ModelNode): Array<{ material: string; mesh: MeshData }> {
  const slots = (parts: MeshPart[], map: Record<string, string>) => parts.filter((p) => p.mesh.indices.length).map((p) => ({ material: map[p.slot] ?? map.main!, mesh: p.mesh }));
  switch (n.kind) {
    case 'primitive': return [{ material: n.material, mesh: primitiveMesh(n.shape, n.params) }];
    case 'rock': return [{ material: n.material, mesh: rockMesh(n.params) }];
    case 'wall': return slots(wallMesh(n.length, n.height, n.thickness, n.openings), { main: n.material, inner: n.innerMaterial ?? n.material });
    case 'roof': return [{ material: n.material, mesh: roofMesh(n.style, n.width, n.depth, n.rise, n.overhang, n.thickness, n.damage, n.seed) }];
    case 'stairs': return n.shape || n.style || n.railing
      ? slots(stairsDesign({ width: n.width, rise: n.rise, run: n.run, steps: n.steps, ...(n.shape ? { shape: n.shape } : {}), ...(n.style ? { style: n.style } : {}), ...(n.turn ? { turn: n.turn } : {}), ...(n.landing ? { landing: n.landing } : {}), ...(n.gap ? { gap: n.gap } : {}), ...(n.treadThickness ? { treadThickness: n.treadThickness } : {}), ...(n.railing !== undefined ? { railing: n.railing } : {}) }), { main: n.material, tread: n.treadMaterial ?? n.material, rail: n.railMaterial ?? n.material, handrail: n.handrailMaterial ?? n.railMaterial ?? n.material })
      : [{ material: n.material, mesh: stairsMesh(n.width, n.rise, n.run, n.steps) }];
    case 'slab': return slots(slabParts(n.width, n.depth, n.thickness, n.holes), { main: n.material, bottom: n.bottomMaterial ?? n.material });
    default: return [];
  }
}

export interface DrawItem { node: string; material: string; mesh: MeshData; matrix: Mat4; collides: boolean }
export interface AssetRef { node: string; asset: number; matrix: Mat4 }
export interface ImportRef { node: string; file: string; matrix: Mat4 }

export interface Evaluated {
  draws: DrawItem[];
  assets: AssetRef[];
  imports: ImportRef[];
  matrices: Map<string, Mat4>;
}

const NON_COLLIDING = new Set(['glass', 'leaves', 'fabric']);

/** Whether a part collides in game (`collision` on it or a parent, else by what it is). */
export function collides(doc: ModelDoc, n: ModelNode): boolean {
  const byId = new Map(doc.nodes.map((x) => [x.id, x]));
  for (let at: ModelNode | undefined = n, i = 0; at && i < 64; at = at.parent ? byId.get(at.parent) : undefined, i++) {
    if (at.collision === 'mesh') return true;
    if (at.collision === 'none') return false;
  }
  if ('material' in n) {
    const m = doc.materials.find((x) => x.id === n.material);
    if (m && (m.opacity < .99 || NON_COLLIDING.has(m.texture.pattern))) return false;
  }
  return true;
}

/** Everything the document draws, in model space. Hidden parts are left out. */
export function evaluate(doc: ModelDoc): Evaluated {
  const matrices = worldMatrices(doc);
  const draws: DrawItem[] = [], assets: AssetRef[] = [], imports: ImportRef[] = [];
  for (const n of doc.nodes) {
    if (!effectiveVisible(doc, n.id)) continue;
    const m = matrices.get(n.id)!;
    if (n.kind === 'asset') { assets.push({ node: n.id, asset: n.asset, matrix: m }); continue; }
    if (n.kind === 'import') { imports.push({ node: n.id, file: n.file, matrix: m }); continue; }
    const hit = collides(doc, n);
    for (const p of nodeMeshes(n)) draws.push({ node: n.id, material: p.material, mesh: p.mesh, matrix: m, collides: hit });
  }
  return { draws, assets, imports, matrices };
}

/** A mesh moved into model space (normals by the inverse transpose; mirrored parts re-wound). */
export function bakeMesh(mesh: MeshData, m: Mat4): MeshData {
  const pos = new Float32Array(mesh.positions.length), nrm = new Float32Array(mesh.normals.length);
  // Inverse transpose of the upper 3×3.
  const a = m[0]!, b = m[4]!, c = m[8]!, d = m[1]!, e = m[5]!, f = m[9]!, g = m[2]!, h = m[6]!, i = m[10]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  for (let k = 0; k < mesh.positions.length; k += 3) {
    const [x, y, z] = transformPoint(m, mesh.positions[k]!, mesh.positions[k + 1]!, mesh.positions[k + 2]!);
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
    const nx = mesh.normals[k]!, ny = mesh.normals[k + 1]!, nz = mesh.normals[k + 2]!;
    const ox = A * nx + B * ny + C * nz, oy = D * nx + E * ny + F * nz, oz = G * nx + H * ny + I * nz;
    const l = Math.hypot(ox, oy, oz) || 1, sgn = det < 0 ? -1 : 1;
    nrm[k] = ox / l * sgn; nrm[k + 1] = oy / l * sgn; nrm[k + 2] = oz / l * sgn;
  }
  let indices = mesh.indices;
  if (det < 0) { indices = new Uint32Array(mesh.indices); for (let k = 0; k < indices.length; k += 3) { const t = indices[k + 1]!; indices[k + 1] = indices[k + 2]!; indices[k + 2] = t; } }
  return { positions: pos, normals: nrm, uvs: mesh.uvs, indices };
}

/** Joins meshes into one (same vertex layout). */
export function mergeMeshes(meshes: MeshData[]): MeshData {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length / 3; ni += m.indices.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    pos.set(m.positions, ov * 3); nrm.set(m.normals, ov * 3); uv.set(m.uvs, ov * 2);
    for (let k = 0; k < m.indices.length; k++) idx[oi + k] = m.indices[k]! + ov;
    ov += m.positions.length / 3; oi += m.indices.length;
  }
  return { positions: pos, normals: nrm, uvs: uv, indices: idx };
}

/** Bounds of the drawn geometry in model space (assets by their registry bounds when given). */
export function bounds(ev: Evaluated, assetBounds?: (asset: number) => { radius: number; height: number } | undefined): { min: [number, number, number]; max: [number, number, number] } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const add = (p: [number, number, number]) => { for (let c = 0; c < 3; c++) { if (p[c]! < min[c]!) min[c] = p[c]!; if (p[c]! > max[c]!) max[c] = p[c]!; } };
  for (const d of ev.draws) for (let k = 0; k < d.mesh.positions.length; k += 3) add(transformPoint(d.matrix, d.mesh.positions[k]!, d.mesh.positions[k + 1]!, d.mesh.positions[k + 2]!));
  for (const a of ev.assets) {
    const b = assetBounds?.(a.asset);
    if (!b) { add(transformPoint(a.matrix, 0, 0, 0)); continue; }
    for (const [x, y, z] of [[-b.radius, 0, -b.radius], [b.radius, b.height, b.radius], [-b.radius, b.height, b.radius], [b.radius, 0, -b.radius]] as const) add(transformPoint(a.matrix, x, y, z));
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
