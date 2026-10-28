/**
 * glTF 2.0 binary (GLB) in and out, without three.js: a small scene structure — nodes with
 * transforms and children, meshes of triangle primitives (position, normal, uv, indices), PBR
 * materials with base colour / normal / metallic-roughness / occlusion textures, embedded
 * images — written to one GLB, and read back from a GLB (or a .gltf with embedded data URIs) so
 * an imported or previously exported model can be merged into a new export. Compressed
 * geometry (Draco, meshopt) is reported as unsupported rather than read wrongly.
 */
export interface GltfImage { mime: string; bytes: Uint8Array; name?: string }
export interface GltfTextureRef { image: number; texCoord?: number }
export interface GltfMaterial {
  name: string;
  baseColorFactor: [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
  baseColorTexture?: GltfTextureRef;
  normalTexture?: GltfTextureRef & { scale?: number };
  metallicRoughnessTexture?: GltfTextureRef;
  occlusionTexture?: GltfTextureRef & { strength?: number };
  emissiveFactor?: [number, number, number];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extras?: Record<string, unknown>;
}
export interface GltfPrimitive { positions: Float32Array; normals?: Float32Array; uvs?: Float32Array; indices?: Uint32Array; material?: number }
export interface GltfMesh { name: string; primitives: GltfPrimitive[] }
export interface GltfNode {
  name: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  mesh?: number;
  children: number[];
  extras?: Record<string, unknown>;
}
export interface GltfScene {
  nodes: GltfNode[];
  roots: number[];
  meshes: GltfMesh[];
  materials: GltfMaterial[];
  images: GltfImage[];
  extras?: Record<string, unknown>;
}

export const emptyScene = (): GltfScene => ({ nodes: [], roots: [], meshes: [], materials: [], images: [] });

const align4 = (n: number) => (n + 3) & ~3;

export function writeGlb(scene: GltfScene, generator = 'Zion Model Studio'): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Array<Record<string, unknown>> = [], accessors: Array<Record<string, unknown>> = [];
  const view = (bytes: Uint8Array, target?: number): number => {
    const offset = byteLength;
    chunks.push(bytes);
    const pad = align4(bytes.length) - bytes.length;
    if (pad) chunks.push(new Uint8Array(pad));
    byteLength += bytes.length + pad;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    return bufferViews.length - 1;
  };
  const accessor = (data: Float32Array | Uint32Array | Uint16Array, type: 'VEC3' | 'VEC2' | 'SCALAR', target: number, minmax = false): number => {
    const comps = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const bv = view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target);
    const acc: Record<string, unknown> = { bufferView: bv, componentType: data instanceof Float32Array ? 5126 : data instanceof Uint32Array ? 5125 : 5123, count: data.length / comps, type };
    if (minmax) {
      const min = new Array<number>(comps).fill(Infinity), max = new Array<number>(comps).fill(-Infinity);
      for (let i = 0; i < data.length; i++) { const c = i % comps; if (data[i]! < min[c]!) min[c] = data[i]!; if (data[i]! > max[c]!) max[c] = data[i]!; }
      acc.min = min; acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const meshes = scene.meshes.map((m) => ({
    name: m.name,
    primitives: m.primitives.filter((p) => p.positions.length >= 9).map((p) => {
      const attributes: Record<string, number> = { POSITION: accessor(p.positions, 'VEC3', 34962, true) };
      if (p.normals) attributes.NORMAL = accessor(p.normals, 'VEC3', 34962);
      if (p.uvs) attributes.TEXCOORD_0 = accessor(p.uvs, 'VEC2', 34962);
      const prim: Record<string, unknown> = { attributes, mode: 4 };
      if (p.indices) prim.indices = accessor(p.positions.length / 3 <= 65535 ? Uint16Array.from(p.indices) : p.indices, 'SCALAR', 34963);
      if (p.material !== undefined) prim.material = p.material;
      return prim;
    }),
  }));
  const images = scene.images.map((im, i) => ({ bufferView: view(im.bytes), mimeType: im.mime, name: im.name ?? `image${i}` }));
  const textures = scene.images.map((_, i) => ({ sampler: 0, source: i }));
  const tex = (t?: GltfTextureRef & { scale?: number; strength?: number }) => (t ? { index: t.image, ...(t.texCoord ? { texCoord: t.texCoord } : {}), ...(t.scale !== undefined ? { scale: t.scale } : {}), ...(t.strength !== undefined ? { strength: t.strength } : {}) } : undefined);
  const materials = scene.materials.map((m) => {
    const pbr: Record<string, unknown> = { baseColorFactor: m.baseColorFactor, metallicFactor: m.metallicFactor, roughnessFactor: m.roughnessFactor };
    if (m.baseColorTexture) pbr.baseColorTexture = tex(m.baseColorTexture);
    if (m.metallicRoughnessTexture) pbr.metallicRoughnessTexture = tex(m.metallicRoughnessTexture);
    return {
      name: m.name, pbrMetallicRoughness: pbr,
      ...(m.normalTexture ? { normalTexture: tex(m.normalTexture) } : {}),
      ...(m.occlusionTexture ? { occlusionTexture: tex(m.occlusionTexture) } : {}),
      ...(m.emissiveFactor ? { emissiveFactor: m.emissiveFactor } : {}),
      ...(m.alphaMode && m.alphaMode !== 'OPAQUE' ? { alphaMode: m.alphaMode } : {}),
      ...(m.alphaMode === 'MASK' ? { alphaCutoff: m.alphaCutoff ?? .5 } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
      ...(m.extras ? { extras: m.extras } : {}),
    };
  });
  const nodes = scene.nodes.map((n) => ({
    name: n.name,
    ...(n.matrix ? { matrix: n.matrix } : {}),
    ...(n.translation && !n.matrix ? { translation: n.translation } : {}),
    ...(n.rotation && !n.matrix ? { rotation: n.rotation } : {}),
    ...(n.scale && !n.matrix ? { scale: n.scale } : {}),
    ...(n.mesh !== undefined ? { mesh: n.mesh } : {}),
    ...(n.children.length ? { children: n.children } : {}),
    ...(n.extras ? { extras: n.extras } : {}),
  }));
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator },
    scene: 0, scenes: [{ nodes: scene.roots, ...(scene.extras ? { extras: scene.extras } : {}) }],
    nodes, meshes, accessors, bufferViews,
    buffers: [{ byteLength }],
  };
  if (materials.length) json.materials = materials;
  if (images.length) { json.images = images; json.textures = textures; json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]; }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = align4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + byteLength;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  for (let i = jsonBytes.length; i < jsonLen; i++) out[20 + i] = 0x20;
  let o = 20 + jsonLen;
  dv.setUint32(o, byteLength, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export class UnsupportedGltfError extends Error {}

interface Json {
  asset?: { version?: string };
  scene?: number; scenes?: Array<{ nodes?: number[]; extras?: Record<string, unknown> }>;
  nodes?: Array<{ name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number]; extras?: Record<string, unknown>; skin?: number }>;
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number; material?: number; extensions?: Record<string, unknown> }> }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; sparse?: unknown }>;
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  buffers?: Array<{ byteLength: number; uri?: string }>;
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number; baseColorTexture?: { index: number; texCoord?: number }; metallicRoughnessTexture?: { index: number; texCoord?: number } }; normalTexture?: { index: number; scale?: number; texCoord?: number }; occlusionTexture?: { index: number; strength?: number; texCoord?: number }; emissiveFactor?: number[]; alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'; alphaCutoff?: number; doubleSided?: boolean; extras?: Record<string, unknown> }>;
  textures?: Array<{ source?: number; extensions?: Record<string, { source?: number }> }>;
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string; name?: string }>;
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  animations?: unknown[];
  skins?: unknown[];
}

function base64(s: string): Uint8Array {
  if (typeof atob === 'function') { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  return new Uint8Array((globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer.from(s, 'base64'));
}

/** Reads a GLB, or a .gltf whose buffers and images are embedded data URIs. */
export function readGltf(bytes: Uint8Array): GltfScene & { warnings: string[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: Json, bin: Uint8Array | null = null;
  if (bytes.length >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    const jsonLen = dv.getUint32(12, true);
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as Json;
    const at = 20 + align4(jsonLen);
    if (at + 8 <= bytes.length) { const len = dv.getUint32(at, true); bin = bytes.subarray(at + 8, at + 8 + len); }
  } else {
    try { json = JSON.parse(new TextDecoder().decode(bytes)) as Json; } catch { throw new UnsupportedGltfError('Không phải file GLB/GLTF hợp lệ.'); }
  }
  const warnings: string[] = [];
  const unsupported = (json.extensionsRequired ?? []).filter((e) => !['KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_materials_unlit'].includes(e));
  if (unsupported.length) throw new UnsupportedGltfError(`Model dùng phần mở rộng chưa hỗ trợ khi xuất/gộp: ${unsupported.join(', ')} (hãy xuất lại không nén).`);
  if (json.animations?.length) warnings.push('Animation trong file không được giữ khi gộp (chỉ giữ hình học và vật liệu).');
  if (json.skins?.length) warnings.push('Model có skin/khung xương: được gộp ở tư thế tĩnh.');
  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri?.startsWith('data:')) return base64(b.uri.slice(b.uri.indexOf(',') + 1));
    if (i === 0 && bin) return bin;
    throw new UnsupportedGltfError('File .gltf tham chiếu buffer bên ngoài: hãy dùng GLB hoặc .gltf nhúng dữ liệu.');
  });
  const viewBytes = (i: number): Uint8Array => {
    const v = json.bufferViews![i]!, buf = buffers[v.buffer ?? 0]!;
    return buf.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  };
  const read = (index: number): Float32Array | Uint32Array => {
    const a = json.accessors![index]!;
    if (a.sparse) warnings.push('Accessor dạng sparse: bỏ phần sparse.');
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type] ?? 1;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
    const out = a.componentType === 5126 || !(a.type === 'SCALAR') ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
    if (a.bufferView === undefined) return out;
    const v = json.bufferViews![a.bufferView]!, raw = viewBytes(a.bufferView), stride = v.byteStride ?? n * size;
    const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), base = a.byteOffset ?? 0;
    const norm = a.normalized ? (a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : a.componentType === 5120 ? 127 : a.componentType === 5122 ? 32767 : 1) : 1;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) {
      const o = base + i * stride + c * size;
      const val = a.componentType === 5126 ? d.getFloat32(o, true) : a.componentType === 5125 ? d.getUint32(o, true) : a.componentType === 5123 ? d.getUint16(o, true) : a.componentType === 5122 ? d.getInt16(o, true) : a.componentType === 5120 ? d.getInt8(o) : d.getUint8(o);
      out[i * n + c] = val / norm;
    }
    return out;
  };
  const scene: GltfScene & { warnings: string[] } = { ...emptyScene(), warnings };
  // Images and textures (texture index → image index).
  for (const im of json.images ?? []) {
    if (im.bufferView !== undefined) scene.images.push({ mime: im.mimeType ?? 'image/png', bytes: viewBytes(im.bufferView).slice(), ...(im.name ? { name: im.name } : {}) });
    else if (im.uri?.startsWith('data:')) scene.images.push({ mime: im.uri.slice(5, im.uri.indexOf(';')), bytes: base64(im.uri.slice(im.uri.indexOf(',') + 1)) });
    else { warnings.push(`Ảnh ngoài "${im.uri}" không nhúng: bỏ qua.`); scene.images.push({ mime: 'image/png', bytes: new Uint8Array(0) }); }
  }
  const texImage = (t?: { index: number; texCoord?: number }) => {
    if (!t) return undefined;
    const tx = json.textures?.[t.index];
    const src = tx?.source ?? Object.values(tx?.extensions ?? {})[0]?.source;
    if (src === undefined || !scene.images[src]?.bytes.length) return undefined;
    return { image: src, ...(t.texCoord ? { texCoord: t.texCoord } : {}) };
  };
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    const bc = texImage(p.baseColorTexture), nt = texImage(m.normalTexture), mr = texImage(p.metallicRoughnessTexture), oc = texImage(m.occlusionTexture);
    scene.materials.push({
      name: m.name ?? 'material',
      baseColorFactor: (p.baseColorFactor as [number, number, number, number] | undefined) ?? [1, 1, 1, 1],
      metallicFactor: p.metallicFactor ?? 1, roughnessFactor: p.roughnessFactor ?? 1,
      ...(bc ? { baseColorTexture: bc } : {}),
      ...(nt ? { normalTexture: { ...nt, ...(m.normalTexture?.scale !== undefined ? { scale: m.normalTexture.scale } : {}) } } : {}),
      ...(mr ? { metallicRoughnessTexture: mr } : {}),
      ...(oc ? { occlusionTexture: { ...oc, ...(m.occlusionTexture?.strength !== undefined ? { strength: m.occlusionTexture.strength } : {}) } } : {}),
      ...(m.emissiveFactor ? { emissiveFactor: m.emissiveFactor as [number, number, number] } : {}),
      ...(m.alphaMode ? { alphaMode: m.alphaMode } : {}), ...(m.alphaCutoff !== undefined ? { alphaCutoff: m.alphaCutoff } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}), ...(m.extras ? { extras: m.extras } : {}),
    });
  }
  for (const m of json.meshes ?? []) {
    const prims: GltfPrimitive[] = [];
    for (const p of m.primitives) {
      if (p.extensions && Object.keys(p.extensions).some((k) => k.includes('draco'))) throw new UnsupportedGltfError('Hình học nén Draco: hãy xuất lại không nén.');
      if ((p.mode ?? 4) !== 4) { warnings.push('Bỏ primitive không phải tam giác (đường/điểm).'); continue; }
      if (p.attributes.POSITION === undefined) continue;
      const positions = read(p.attributes.POSITION) as Float32Array;
      const normals = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) as Float32Array : undefined;
      const uvs = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) as Float32Array : undefined;
      const indices = p.indices !== undefined ? Uint32Array.from(read(p.indices)) : undefined;
      prims.push({ positions, ...(normals ? { normals } : {}), ...(uvs ? { uvs } : {}), ...(indices ? { indices } : {}), ...(p.material !== undefined ? { material: p.material } : {}) });
    }
    scene.meshes.push({ name: m.name ?? 'mesh', primitives: prims });
  }
  for (const n of json.nodes ?? []) {
    scene.nodes.push({
      name: n.name ?? 'node', children: [...(n.children ?? [])],
      ...(n.matrix ? { matrix: n.matrix } : {}), ...(n.translation ? { translation: n.translation } : {}), ...(n.rotation ? { rotation: n.rotation } : {}), ...(n.scale ? { scale: n.scale } : {}),
      ...(n.mesh !== undefined ? { mesh: n.mesh } : {}), ...(n.extras ? { extras: n.extras } : {}),
    });
  }
  const sc = json.scenes?.[json.scene ?? 0];
  scene.roots = [...(sc?.nodes ?? scene.nodes.map((_, i) => i).filter((i) => !scene.nodes.some((n) => n.children.includes(i))))];
  if (sc?.extras) scene.extras = sc.extras;
  return scene;
}

/** Copies `src` into `dst` (images, materials, meshes, nodes re-indexed); returns `src`'s roots in `dst`. */
export function mergeScene(dst: GltfScene, src: GltfScene): number[] {
  const io = dst.images.length, mo = dst.materials.length, meo = dst.meshes.length, no = dst.nodes.length;
  dst.images.push(...src.images);
  const shift = <T extends { image: number }>(t: T | undefined) => (t ? { ...t, image: t.image + io } : undefined);
  for (const m of src.materials) dst.materials.push({ ...m, ...(m.baseColorTexture ? { baseColorTexture: shift(m.baseColorTexture)! } : {}), ...(m.normalTexture ? { normalTexture: shift(m.normalTexture)! } : {}), ...(m.metallicRoughnessTexture ? { metallicRoughnessTexture: shift(m.metallicRoughnessTexture)! } : {}), ...(m.occlusionTexture ? { occlusionTexture: shift(m.occlusionTexture)! } : {}) });
  for (const m of src.meshes) dst.meshes.push({ name: m.name, primitives: m.primitives.map((p) => ({ ...p, ...(p.material !== undefined ? { material: p.material + mo } : {}) })) });
  for (const n of src.nodes) dst.nodes.push({ ...n, children: n.children.map((c) => c + no), ...(n.mesh !== undefined ? { mesh: n.mesh + meo } : {}) });
  return src.roots.map((r) => r + no);
}

/** Quaternion [x, y, z, w] of XYZ Euler angles (three.js order). */
export function eulerToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const c1 = Math.cos(rx / 2), c2 = Math.cos(ry / 2), c3 = Math.cos(rz / 2), s1 = Math.sin(rx / 2), s2 = Math.sin(ry / 2), s3 = Math.sin(rz / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
