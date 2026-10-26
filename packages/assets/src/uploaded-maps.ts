import type { AssetDefinitionInput, ColliderDefinition } from './schema';

/**
 * Map models uploaded in the Studio (Infection maps): a whole map as one GLB. Each gets a numeric
 * id in a reserved range and is registered at runtime (servers, workers and clients alike). It
 * collides as itself: its textured, opaque triangles (the hit mesh, read from the file by whoever
 * plays it), found through one box over the whole model — every gap and doorway as it is.
 */
export const UPLOADED_MAP_ASSET_MIN = 2900;
export const UPLOADED_MAP_ASSET_MAX = 2999;
/** Where clients fetch an uploaded map model (`uploads/…` in the asset definition). */
export const uploadedMapPath = (asset: number) => `uploads/infection-map-${asset}.glb`;
export const uploadedMapUrl = (asset: number, version: number) => `/api/infection-maps/models/${asset}.glb?v=${version}`;

type Vec3 = [number, number, number];
type Mat4 = number[];

const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Column-major a·b. */
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
function compose(t: Vec3, q: [number, number, number, number], s: Vec3): Mat4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const apply = (m: Mat4, x: number, y: number, z: number): Vec3 => [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];

interface Gltf {
  scene?: number; scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{ mesh?: number; children?: number[]; matrix?: number[]; translation?: Vec3; rotation?: [number, number, number, number]; scale?: Vec3 }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number; material?: number }> }>;
  materials?: Array<{ alphaMode?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown }; extensions?: Record<string, { diffuseTexture?: unknown }> }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
}

/** A material players collide with: it has a colour texture and is opaque. */
export function solidMaterial(m: { alphaMode?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown }; extensions?: Record<string, { diffuseTexture?: unknown }> } | undefined): boolean {
  if (!m) return false;
  const textured = !!m.pbrMetallicRoughness?.baseColorTexture || !!m.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture;
  return textured && (m.alphaMode ?? 'OPAQUE') === 'OPAQUE';
}

/**
 * Every triangle of a GLB in scene space (node transforms applied). `solid`: only what a player
 * bumps into — textured, opaque surfaces (not see-through foliage, glass, helper or untextured
 * meshes); all of them when the model has none such.
 */
export function glbTriangles(glb: Uint8Array, solid = false): Vec3[][] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Gltf;
  const binStart = 20 + jsonLength + 8;
  const read = (index: number): number[] => {
    const a = json.accessors![index]!, v = json.bufferViews![a.bufferView!]!;
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type] ?? 1;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
    const stride = v.byteStride ?? n * size, base = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out: number[] = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) {
      const o = base + i * stride + c * size;
      out.push(a.componentType === 5126 ? view.getFloat32(o, true) : a.componentType === 5125 ? view.getUint32(o, true) : a.componentType === 5123 ? view.getUint16(o, true) : a.componentType === 5122 ? view.getInt16(o, true) : a.componentType === 5120 ? view.getInt8(o) : view.getUint8(o));
    }
    return out;
  };
  const tris: Vec3[][] = [];
  const visit = (i: number, parent: Mat4) => {
    const n = json.nodes![i]!;
    const local = n.matrix ? n.matrix.slice() : compose(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
    const world = mul(parent, local);
    if (n.mesh !== undefined) for (const p of json.meshes![n.mesh]!.primitives) {
      if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) continue;
      if (solid && !solidMaterial(json.materials?.[p.material ?? -1])) continue;
      const pos = read(p.attributes.POSITION), idx = p.indices !== undefined ? read(p.indices) : Array.from({ length: pos.length / 3 }, (_, k) => k);
      const at = (k: number) => apply(world, pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!);
      for (let k = 0; k + 2 < idx.length; k += 3) tris.push([at(idx[k]!), at(idx[k + 1]!), at(idx[k + 2]!)]);
    }
    for (const c of n.children ?? []) visit(c, world);
  };
  for (const i of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(i, identity());
  if (solid && !tris.length) { solid = false; for (const i of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(i, identity()); }
  return tris;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Collision for a whole map model: every triangle rasterised into a sparse voxel grid (`cell` m),
 * then greedily merged into as few boxes as possible; lone cells (small clutter) are dropped.
 * Only the surfaces are marked, so rooms, doorways and gaps between things stay open down to a
 * couple of cells.
 */
export function voxelColliders(tris: Vec3[][], cell: number, maxBoxes = MAX_MAP_BOXES): ColliderDefinition[] {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, p[c]!); max[c] = Math.max(max[c]!, p[c]!); }
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const at = (i: number, j: number, k: number) => (j * nz + k) * nx + i;
  const cells = new Set<number>();
  const limit = maxBoxes * 40;
  for (const [a, b, c] of tris as Array<[Vec3, Vec3, Vec3]>) {
    const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.max(1, Math.ceil(len / (cell * .5)));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      const s = u / n, t = v / n, w = 1 - s - t;
      cells.add(at(Math.floor((a[0] * w + b[0] * s + c[0] * t - min[0]) / cell), Math.floor((a[1] * w + b[1] * s + c[1] * t - min[1]) / cell), Math.floor((a[2] * w + b[2] * s + c[2] * t - min[2]) / cell)));
    }
    if (cells.size > limit) throw new Error('map model too detailed for collision');
  }
  const has = (i: number, j: number, k: number) => i >= 0 && k >= 0 && j >= 0 && i < nx && k < nz && cells.has(at(i, j, k));
  const split = (key: number): [number, number, number] => { const i = key % nx, rest = (key - i) / nx, k = rest % nz; return [i, (rest - k) / nz, k]; };
  for (const key of [...cells]) {
    const [i, j, k] = split(key);
    if (!has(i + 1, j, k) && !has(i - 1, j, k) && !has(i, j + 1, k) && !has(i, j - 1, k) && !has(i, j, k + 1) && !has(i, j, k - 1)) cells.delete(key);
  }
  const used = new Set<number>(), out: ColliderDefinition[] = [];
  const free = (i: number, j: number, k: number) => has(i, j, k) && !used.has(at(i, j, k));
  for (const key of [...cells].sort((x, y) => x - y)) {
    const [i, j, k] = split(key);
    if (!free(i, j, k)) continue;
    let i1 = i; while (free(i1 + 1, j, k)) i1++;
    let k1 = k;
    grow: for (;;) { for (let x = i; x <= i1; x++) if (!free(x, j, k1 + 1)) break grow; k1++; }
    let j1 = j;
    up: for (;;) { for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) if (!free(x, j1 + 1, z)) break up; j1++; }
    for (let y = j; y <= j1; y++) for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) used.add(at(x, y, z));
    const x0 = min[0] + i * cell, y0 = min[1] + j * cell, z0 = min[2] + k * cell, x1 = min[0] + (i1 + 1) * cell, y1 = min[1] + (j1 + 1) * cell, z1 = min[2] + (k1 + 1) * cell;
    out.push({ type: 'box', center: [r3((x0 + x1) / 2), r3((y0 + y1) / 2), r3((z0 + z1) / 2)], halfExtents: [r3((x1 - x0) / 2), r3((y1 - y0) / 2), r3((z1 - z0) / 2)] } as ColliderDefinition);
    if (out.length > maxBoxes) throw new Error('map model too detailed for collision');
  }
  return out;
}

/** Most collision boxes one map model may have. */
export const MAX_MAP_BOXES = 60000;

/** Collision and placement of an uploaded map model, from its triangles (scene space). */
export interface UploadedMapFit { offset: Vec3; colliders: ColliderDefinition[]; bounds: { radius: number; height: number } }

/**
 * Centres the model on its footprint with its lowest point at 0. Its collision is the model
 * itself: one box over all of it, marked solid (the triangles inside decide).
 */
export function uploadedMapFit(raw: Vec3[][]): UploadedMapFit {
  if (!raw.length) throw new Error('the model has no triangles');
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of raw) for (const p of t) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, p[c]!); max[c] = Math.max(max[c]!, p[c]!); }
  const offset: Vec3 = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  const half: Vec3 = [Math.max(.05, (max[0] - min[0]) / 2), Math.max(.05, (max[1] - min[1]) / 2), Math.max(.05, (max[2] - min[2]) / 2)];
  const colliders = [{ type: 'box', center: [0, r3(half[1]), 0], halfExtents: half.map((v) => r3(v + .05)), solid: true } as ColliderDefinition];
  return {
    offset: offset.map(r3) as Vec3, colliders,
    bounds: { radius: Math.max(.001, r3(Math.hypot(max[0] - min[0], max[2] - min[2]) / 2)), height: Math.max(.001, r3(max[1] - min[1])) },
  };
}

/** The asset definition of an uploaded map model (its fit computed from the file when not given). */
export function uploadedMapAsset(asset: number, name: string, glb: Uint8Array, fit?: UploadedMapFit): AssetDefinitionInput {
  const f = fit ?? uploadedMapFit(glbTriangles(glb, true));
  // Older uploads carry voxel boxes: their model itself collides now.
  if (!f.colliders.some((c) => (c as { solid?: boolean }).solid)) Object.assign(f, { colliders: uploadedMapFit(glbTriangles(glb, true)).colliders });
  return {
    id: `uploaded.infection_map_${asset}`, numericId: asset, name, category: 'structure',
    model: { kind: 'glb', path: uploadedMapPath(asset), scale: 1, offset: f.offset },
    colliders: f.colliders, collisionLayer: 'static', bounds: f.bounds,
    render: { maxDistance: 1000 }, tags: ['infection-map'],
  } as AssetDefinitionInput;
}

/**
 * The triangles players collide with in an uploaded map model (textured, opaque surfaces), placed
 * as the asset draws it (its centring offset applied): the collision world's hit mesh for it.
 */
export function uploadedMapHitMesh(glb: Uint8Array, offset: readonly [number, number, number]): { tris: Float32Array } {
  const tris = glbTriangles(glb, true), out = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) for (const p of t) { out[o++] = p[0] + offset[0]; out[o++] = p[1] + offset[1]; out[o++] = p[2] + offset[2]; }
  return { tris: out };
}
