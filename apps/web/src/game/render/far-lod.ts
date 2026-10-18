import { BufferGeometry, Color, Float32BufferAttribute, MeshLambertMaterial, type Material, type Texture } from 'three';
import type { AssetVisual } from './asset-library';

/** Shared material of every far model: flat-shaded vertex colours, no textures. */
export const farMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Far foliage (trees, bushes): not flat facets but a soft, grainy canopy, as leaves read from
 * afar: smooth shading broken into small world-space blotches of light and shade.
 */
export const farFoliageMaterial = new MeshLambertMaterial({ vertexColors: true });
farFoliageMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vFoliage;`)
    .replace('#include <project_vertex>', `
      vec4 foliagePos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        foliagePos = instanceMatrix * foliagePos;
      #endif
      vFoliage = (modelMatrix * foliagePos).xyz;
      #include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vFoliage;
      float foliageHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cell = floor(vFoliage * 2.6);
      float grain = foliageHash(cell) * 0.6 + foliageHash(floor(vFoliage * 0.9)) * 0.4;
      diffuseColor.rgb *= 0.72 + grain * 0.5;`);
};
farFoliageMaterial.customProgramCacheKey = () => 'far-foliage';

const sampled = new WeakMap<object, Color>();
/** Average colour of a texture (drawn into a few pixels); white when it cannot be read. */
function textureColor(map: Texture | null | undefined): Color {
  const image = map?.image as (CanvasImageSource & { width?: number }) | undefined;
  if (!image || typeof document === 'undefined') return new Color(1, 1, 1);
  const known = sampled.get(image);
  if (known) return known.clone();
  const out = new Color(1, 1, 1);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(image, 0, 0, 4, 4);
      const d = ctx.getImageData(0, 0, 4, 4).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; }
      out.setRGB(r / 16 / 255, g / 16 / 255, b / 16 / 255).convertSRGBToLinear();
    }
  } catch { /* cross-origin or not decoded yet: keep white */ }
  sampled.set(image, out);
  return out.clone();
}

/** One flat colour per material: its colour times its texture's average. */
function materialColor(material: Material): Color {
  const m = material as Material & { color?: Color; map?: Texture | null };
  const base = m.color ? m.color.clone() : new Color(1, 1, 1);
  return base.multiply(textureColor(m.map));
}

/**
 * Far model of an asset: the same silhouette, rebuilt by vertex clustering on a coarse grid so a
 * tree keeps its trunk and crown shape (and a house its walls and roof) with a few hundred
 * triangles, coloured flat from the original materials. Not hidden, not a different shape.
 */
export function simplifyAsset(v: AssetVisual, cells = 7): BufferGeometry {
  const points: number[] = [], colors: number[] = [], triangles: number[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of v.parts) {
    const position = part.geometry.getAttribute('position');
    if (!position) continue;
    const color = materialColor(Array.isArray(part.material) ? part.material[0] : part.material);
    const vertexColor = part.geometry.getAttribute('color');
    const offset = points.length / 3;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      points.push(x, y, z);
      const tint = vertexColor ? [vertexColor.getX(i), vertexColor.getY(i), vertexColor.getZ(i)] : [1, 1, 1];
      colors.push(color.r * tint[0]!, color.g * tint[1]!, color.b * tint[2]!);
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    const index = part.geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) triangles.push(offset + index.getX(i));
    else for (let i = 0; i < position.count; i++) triangles.push(offset + i);
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3), cell = size / cells;
  // Cluster vertices into grid cells; each cell becomes one vertex at its members' mean.
  const clusterOf = new Int32Array(points.length / 3), keys = new Map<string, number>();
  const sum: number[] = [], count: number[] = [];
  for (let i = 0; i < points.length / 3; i++) {
    const key = `${Math.floor((points[i * 3]! - minX) / cell)}:${Math.floor((points[i * 3 + 1]! - minY) / cell)}:${Math.floor((points[i * 3 + 2]! - minZ) / cell)}`;
    let c = keys.get(key);
    if (c === undefined) { c = count.length; keys.set(key, c); count.push(0); sum.push(0, 0, 0, 0, 0, 0); }
    clusterOf[i] = c; count[c]!++;
    for (let k = 0; k < 3; k++) { sum[c * 6 + k]! += points[i * 3 + k]!; sum[c * 6 + 3 + k]! += colors[i * 3 + k]!; }
  }
  const seen = new Set<string>(), position: number[] = [], color: number[] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = clusterOf[triangles[t]!]!, b = clusterOf[triangles[t + 1]!]!, c = clusterOf[triangles[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    // Non-indexed so flat shading gives each face its own facet colour.
    for (const k of [a, b, c]) {
      const n = count[k]!;
      position.push(sum[k * 6]! / n, sum[k * 6 + 1]! / n, sum[k * 6 + 2]! / n);
      color.push(sum[k * 6 + 3]! / n, sum[k * 6 + 4]! / n, sum[k * 6 + 5]! / n);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
