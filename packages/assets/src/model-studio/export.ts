import type { ModelDoc, ModelMaterial } from './doc';
import { bakeMesh, bounds, evaluate, mergeMeshes, nodeMeshes, transformPoint, type Mat4 } from './evaluate';
import { emptyScene, eulerToQuat, mergeScene, readGltf, writeGlb, type GltfMaterial, type GltfNode, type GltfScene } from './gltf';
import type { MeshData } from './mesh';
import { encodePng, type Deflate } from './png';
import { materialTextures } from './textures';

/**
 * A project to GLB, two ways:
 *  - `editable`: the project's hierarchy as glTF nodes (names, transforms), every procedural
 *    part its own mesh, the project itself in the scene extras — importing the file back into
 *    the Studio restores every part's parameters, not just triangles;
 *  - `game`: what the game loads — all procedural geometry baked into model space and merged
 *    per material (one draw call per material), parts that must not collide on materials the
 *    game's collision skips; models of the game stay separate placements (`refs`, drawn
 *    instanced like everywhere else) unless `embedAssets`.
 * Imported files are merged in both. Textures are generated from the materials' recipes.
 */
export interface ExportOptions {
  mode: 'editable' | 'game';
  deflate: Deflate;
  /** Texture edge for materials without their own `resolution`. */
  textureSize?: number;
  /** Bytes of an imported project file. */
  importFile?: (file: string) => Uint8Array | undefined;
  /** Bytes of a game model's GLB (to embed asset parts); undefined → kept as a reference. */
  assetFile?: (asset: number) => Uint8Array | undefined;
  embedAssets?: boolean;
  /** Bytes of an image file used as a material's colour map (decoded PNG/JPEG passes through). */
  imageFile?: (file: string) => { mime: string; bytes: Uint8Array } | undefined;
}

export interface AssetPlacement { asset: number; x: number; y: number; z: number; yaw: number; scale: number }
export interface ExportResult { glb: Uint8Array; refs: AssetPlacement[]; warnings: string[]; triangles: number; materials: number }

function srgbToLinear(c: number): number { return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }

/** glTF materials and images for the project's materials (each texture set encoded once). */
function materialTable(doc: ModelDoc, scene: GltfScene, opts: ExportOptions, warnings: string[]): Map<string, { index: number; scale: number; noCollide: number }> {
  const table = new Map<string, { index: number; scale: number; noCollide: number }>();
  for (const m of doc.materials) {
    const size = m.resolution ?? opts.textureSize ?? 512;
    const set = materialTextures(m, size);
    const blend = m.opacity < .99;
    const img = (bytes: Uint8Array, name: string) => { scene.images.push({ mime: 'image/png', bytes, name }); return scene.images.length - 1; };
    let albedo: number;
    const custom = m.albedoFile ? opts.imageFile?.(m.albedoFile) : undefined;
    if (m.albedoFile && !custom) warnings.push(`Vật liệu "${m.name}": thiếu ảnh ${m.albedoFile}, dùng texture sinh tự động.`);
    if (custom) { scene.images.push({ mime: custom.mime, bytes: custom.bytes, name: `${m.id}_albedo` }); albedo = scene.images.length - 1; }
    else albedo = img(encodePng(set.size, set.size, set.albedo, opts.deflate, blend), `${m.id}_albedo`);
    const normal = img(encodePng(set.size, set.size, set.normal, opts.deflate, false), `${m.id}_normal`);
    const orm = img(encodePng(set.size, set.size, set.orm, opts.deflate, false), `${m.id}_orm`);
    const base: GltfMaterial = {
      name: m.name,
      baseColorFactor: [1, 1, 1, blend ? 1 : 1],
      metallicFactor: 1, roughnessFactor: 1,
      baseColorTexture: { image: albedo }, normalTexture: { image: normal, scale: 1 },
      metallicRoughnessTexture: { image: orm }, occlusionTexture: { image: orm, strength: m.aoStrength },
      ...(m.emissive ? { emissiveFactor: hexLinear(m.emissive, m.emissiveIntensity ?? 1) } : {}),
      alphaMode: blend ? 'BLEND' : 'OPAQUE', doubleSided: m.doubleSided ?? false,
      extras: { zionMaterial: m.id, preset: m.preset ?? null },
    };
    scene.materials.push(base);
    const index = scene.materials.length - 1;
    // Same look, but the game's collision ignores it (only opaque, textured surfaces collide):
    // a mask with an all-opaque texture draws exactly like the original.
    scene.materials.push({ ...base, name: `${m.name} (không va chạm)`, alphaMode: blend ? 'BLEND' : 'MASK', alphaCutoff: .01 });
    table.set(m.id, { index, scale: m.texture.scale, noCollide: index + 1 });
  }
  return table;
}

function hexLinear(hex: string, k: number): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255) * Math.min(1, k), srgbToLinear(((n >> 8) & 255) / 255) * Math.min(1, k), srgbToLinear((n & 255) / 255) * Math.min(1, k)];
}

/** UVs are metres; one texture tile covers `scale` metres. */
function scaledUvs(mesh: MeshData, scale: number): Float32Array {
  const out = new Float32Array(mesh.uvs.length), k = 1 / Math.max(.01, scale);
  for (let i = 0; i < out.length; i++) out[i] = mesh.uvs[i]! * k;
  return out;
}

function decompose(m: Mat4): { t: [number, number, number]; yaw: number; scale: number; tilted: boolean } {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const yaw = Math.atan2(m[8]! / sz, m[10]! / sz);
  const tilted = Math.abs(m[5]! / sy - 1) > .02 || Math.abs(sx - sy) > .02 || Math.abs(sz - sy) > .02;
  return { t: [m[12]!, m[13]!, m[14]!], yaw, scale: (sx + sy + sz) / 3, tilted };
}

export function exportModel(doc: ModelDoc, opts: ExportOptions): ExportResult {
  const scene = emptyScene(), warnings: string[] = [], refs: AssetPlacement[] = [];
  const mats = materialTable(doc, scene, opts, warnings);
  const ev = evaluate(doc);
  let triangles = 0;
  const importScene = (file: string): number[] | null => {
    const bytes = opts.importFile?.(file);
    if (!bytes) { warnings.push(`Thiếu file import ${file}.`); return null; }
    try { const s = readGltf(bytes); warnings.push(...s.warnings); for (const m of s.meshes) for (const p of m.primitives) triangles += (p.indices?.length ?? p.positions.length / 3) / 3; return mergeScene(scene, s); }
    catch (err) { warnings.push(`File ${file}: ${(err as Error).message}`); return null; }
  };
  const assetScene = (asset: number): number[] | null => {
    if (!opts.embedAssets) return null;
    const bytes = opts.assetFile?.(asset);
    if (!bytes) { warnings.push(`Model game #${asset} không nhúng được (model procedural/bbmodel hoặc GLB nén); giữ dạng tham chiếu.`); return null; }
    try { const s = readGltf(bytes); return mergeScene(scene, s); } catch (err) { warnings.push(`Model game #${asset}: ${(err as Error).message}; giữ dạng tham chiếu.`); return null; }
  };

  if (opts.mode === 'game') {
    // Bake and merge per material (and collision).
    const groups = new Map<string, MeshData[]>();
    for (const d of ev.draws) {
      const mat = mats.get(d.material);
      if (!mat) { warnings.push(`Phần ${d.node}: thiếu vật liệu ${d.material}.`); continue; }
      const baked = bakeMesh(d.mesh, d.matrix);
      const key = `${d.material}|${d.collides ? 1 : 0}`;
      groups.set(key, [...(groups.get(key) ?? []), { ...baked, uvs: scaledUvs(d.mesh, mat.scale) }]);
    }
    const prims = [...groups.entries()].map(([key, list]) => {
      const [id, c] = key.split('|');
      const m = mergeMeshes(list), mat = mats.get(id!)!;
      triangles += m.indices.length / 3;
      return { positions: m.positions, normals: m.normals, uvs: m.uvs, indices: m.indices, material: c === '1' ? mat.index : mat.noCollide };
    });
    const children: number[] = [];
    if (prims.length) { scene.meshes.push({ name: doc.name, primitives: prims }); scene.nodes.push({ name: doc.name, mesh: 0, children: [] }); children.push(scene.nodes.length - 1); }
    for (const i of ev.imports) {
      const roots = importScene(i.file);
      if (!roots) continue;
      scene.nodes.push({ name: `import:${i.file}`, matrix: Array.from(i.matrix), children: roots });
      children.push(scene.nodes.length - 1);
    }
    for (const a of ev.assets) {
      const roots = assetScene(a.asset);
      if (roots) { scene.nodes.push({ name: `asset:${a.asset}`, matrix: Array.from(a.matrix), children: roots }); children.push(scene.nodes.length - 1); continue; }
      const p = decompose(a.matrix);
      if (p.tilted) warnings.push(`Model game #${a.asset} (${a.node}) nghiêng/co giãn không đều: trong game chỉ giữ hướng xoay ngang và tỉ lệ đều.`);
      refs.push({ asset: a.asset, x: round(p.t[0]), y: round(p.t[1]), z: round(p.t[2]), yaw: round(p.yaw), scale: round(Math.max(.5, Math.min(2, p.scale))) });
      if (p.scale < .5 || p.scale > 2) warnings.push(`Model game #${a.asset}: tỉ lệ ${p.scale.toFixed(2)} ngoài 0.5–2 của game, đã kẹp.`);
    }
    scene.nodes.push({ name: 'root', children, extras: { zionModelStudio: { name: doc.name, kind: doc.kind } } });
    scene.roots = [scene.nodes.length - 1];
  } else {
    // Editable: one glTF node per project node.
    const index = new Map<string, number>();
    for (const n of doc.nodes) {
      const node: GltfNode = { name: n.name, translation: [...n.transform.position], rotation: eulerToQuat(...n.transform.rotation), scale: [...n.transform.scale], children: [], extras: { zionNode: n.id, kind: n.kind } };
      if (n.visible !== false) {
        const parts = nodeMeshes(n);
        if (parts.length) {
          const prims = parts.flatMap((p) => {
            const mat = mats.get(p.material);
            if (!mat) return [];
            triangles += p.mesh.indices.length / 3;
            return [{ positions: p.mesh.positions, normals: p.mesh.normals, uvs: scaledUvs(p.mesh, mat.scale), indices: p.mesh.indices, material: mat.index }];
          });
          if (prims.length) { scene.meshes.push({ name: n.name, primitives: prims }); node.mesh = scene.meshes.length - 1; }
        }
        if (n.kind === 'import') { const roots = importScene(n.file); if (roots) node.children.push(...roots); }
        if (n.kind === 'asset') { const roots = assetScene(n.asset); if (roots) node.children.push(...roots); else node.extras = { ...node.extras, zionAsset: n.asset }; }
      }
      scene.nodes.push(node);
      index.set(n.id, scene.nodes.length - 1);
    }
    for (const n of doc.nodes) if (n.parent && index.has(n.parent)) scene.nodes[index.get(n.parent)!]!.children.push(index.get(n.id)!);
    scene.roots = doc.nodes.filter((n) => !n.parent || !index.has(n.parent)).map((n) => index.get(n.id)!);
    scene.extras = { zionModelDoc: doc };
  }
  const glb = writeGlb(scene);
  return { glb, refs, warnings: [...new Set(warnings)], triangles: Math.round(triangles), materials: doc.materials.length };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Collision triangles (model space) of a project, as the game will see them. */
export function collisionTriangles(doc: ModelDoc): Float32Array {
  const ev = evaluate(doc), out: number[] = [];
  for (const d of ev.draws) {
    if (!d.collides) continue;
    const p = d.mesh.positions, ix = d.mesh.indices;
    for (let t = 0; t < ix.length; t++) { const [x, y, z] = transformPoint(d.matrix, p[ix[t]! * 3]!, p[ix[t]! * 3 + 1]!, p[ix[t]! * 3 + 2]!); out.push(x, y, z); }
  }
  return new Float32Array(out);
}

/** The model's footprint and height for placement (assets included by their bounds). */
export function modelBounds(doc: ModelDoc, assetBounds?: (asset: number) => { radius: number; height: number } | undefined) {
  return bounds(evaluate(doc), assetBounds);
}

export type { ModelMaterial };
