import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  IcosahedronGeometry,
  type Scene,
} from 'three';
import { CHUNK_SIZE, Rng, Surface, chunkKey, dequantizeHeight, lodStep, type ChunkData } from '@zion/shared';
import { FLOWER_COLORS, grassTint } from './palette';
import { chunkHeightAtLocal } from './terrain';
import { windUniforms } from './asset-library';
import { buildProceduralGeometry } from './procedural-models';
import { vegetationPatch } from './vegetation-pattern';

/** Grass density per surface (instances per ~1.2 m cell). */
const GRASS_DENSITY: Partial<Record<Surface, number>> = {
  [Surface.Grass]: 0.95,
  [Surface.JungleFloor]: 0.85,
  [Surface.DryGrass]: 0.7,
  [Surface.ForestFloor]: 0.35,
  [Surface.Mud]: 0.3,
  [Surface.Dirt]: 0.12,
  [Surface.Sand]: 0.04,
  [Surface.Gravel]: 0.05,
};
const FLOWER_DENSITY: Partial<Record<Surface, number>> = {
  [Surface.Grass]: 0.07,
  [Surface.JungleFloor]: 0.05,
  [Surface.DryGrass]: 0.02,
  [Surface.ForestFloor]: 0.02,
};
const CELL = 0.85;
const VEG_RADIUS = 2; // chunks around the player
const REED_TINT = new Color(0xb5ab74);

function bladeClump(blades = 6, height = 1, width = 1, plume = false): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const rng = new Rng(77);
  for (let b = 0; b < blades; b++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.35;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = (0.22 + rng.next() * 0.26) * height;
    const w = 0.035 * width;
    const dir = rng.next() * Math.PI;
    const dx = Math.cos(dir) * w;
    const dz = Math.sin(dir) * w;
    const lean = (rng.next() - 0.5) * 0.25;
    // Two-segment blade (bottom quad + tip triangle) for smooth bending.
    const mid = h * 0.55;
    const pts = [
      [x - dx, 0, z - dz, 0],
      [x + dx, 0, z + dz, 0],
      [x + dx * 0.6 + lean * 0.5, mid, z + dz * 0.6, 0.55],
      [x - dx * 0.6 + lean * 0.5, mid, z - dz * 0.6, 0.55],
      [x + lean, h, z, 1],
    ] as const;
    const tri = (i: number, j: number, k: number) => {
      for (const n of [i, j, k]) {
        const p = pts[n]!;
        pos.push(p[0], p[1], p[2]);
        const t = p[3];
        col.push(0.62 + 0.38 * t, 0.66 + 0.34 * t, 0.55 + 0.4 * t);
      }
    };
    tri(0, 1, 2);
    tri(0, 2, 3);
    tri(3, 2, 4);
    if (plume && b % 2 === 0) {
      // Cream seed heads on crossed planes remain visible from every direction.
      for (const [ax, az] of [[1, 0], [0, 1]] as const) {
        const base = h * 0.86;
        const top = h + 0.25;
        const px = x + lean;
        for (const p of [
          [px - ax * 0.075, base, z - az * 0.075],
          [px + ax * 0.075, base, z + az * 0.075],
          [px + lean * 0.25, top, z],
        ]) {
          pos.push(...p);
          col.push(1.7, 1.55, 1.05);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  // Grass normals point up so lighting reads like a lawn, not like individual cards.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function flowerGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const push = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    pos.push(x, y, z);
    col.push(r, g, b);
  };
  const stem = 0.42;
  // Stem.
  push(-0.01, 0, 0, 0.3, 0.5, 0.2);
  push(0.01, 0, 0, 0.3, 0.5, 0.2);
  push(0, stem, 0, 0.3, 0.5, 0.2);
  // Petal cross (white vertex colour, tinted per instance).
  const s = 0.085;
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    push(-s * ax, stem - s, -s * az, 1, 1, 1);
    push(s * ax, stem - s, s * az, 1, 1, 1);
    push(s * ax, stem + s, s * az, 1, 1, 1);
    push(-s * ax, stem - s, -s * az, 1, 1, 1);
    push(s * ax, stem + s, s * az, 1, 1, 1);
    push(-s * ax, stem + s, -s * az, 1, 1, 1);
  }
  // Upward-facing petals make flower meadows readable from the overhead camera.
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    push(0, stem, 0, 1, 0.85, 0.4);
    push(Math.cos(a - 0.4) * s * 1.5, stem + 0.02, Math.sin(a - 0.4) * s * 1.5, 1, 1, 1);
    push(Math.cos(a + 0.4) * s * 1.5, stem + 0.02, Math.sin(a + 0.4) * s * 1.5, 1, 1, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

function windMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sway = min(position.y * position.y * 0.22, 0.45);
        float w = sin(uTime * 1.9 + iOrigin.x * 0.35 + iOrigin.z * 0.27) + 0.5 * sin(uTime * 3.7 + iOrigin.x * 0.9);
        transformed.x += w * sway;
        transformed.z += w * sway * 0.4;`,
      );
  };
  mat.customProgramCacheKey = () => 'grass-wind';
  return mat;
}

type Cover = 'grass' | 'tufts' | 'tall' | 'reeds' | 'flowers' | 'fern' | 'bush' | 'sapling' | 'conifer' | 'moss';
const COVER_TYPES: readonly Cover[] = ['grass', 'tufts', 'tall', 'reeds', 'flowers', 'fern', 'bush', 'sapling', 'conifer', 'moss'];
type ChunkVegetation = Array<InstancedMesh>;

/**
 * Cosmetic ground cover for chunks near the player. Purely visual and gameplay-irrelevant, so it
 * is scattered on the client from the server-sent biome/surface/height data with the chunk's
 * cosmetic seed (deterministic: every client sees the same grass).
 */
export class VegetationRenderer {
  private readonly perChunk = new Map<number, ChunkVegetation>();
  private readonly geometries: Record<Cover, BufferGeometry> = {
    grass: bladeClump(),
    tufts: bladeClump(12, 1.25, 1.3),
    tall: bladeClump(9, 2.8, 0.8),
    reeds: bladeClump(10, 4.5, 0.7, true),
    flowers: flowerGeometry(),
    fern: buildProceduralGeometry('fern', { radius: 0.75 }, 91),
    bush: buildProceduralGeometry('bush', { radius: 0.6 }, 92),
    sapling: buildProceduralGeometry('birch', { height: 1.8, radius: 0.45 }, 93),
    conifer: buildProceduralGeometry('spruce', { height: 1.6, radius: 0.5, tiers: 4 }, 94),
    moss: new IcosahedronGeometry(0.45, 1).scale(1, 0.13, 1).translate(0, 0.025, 0),
  };
  private readonly material = windMaterial();
  private readonly mossMaterial = new MeshLambertMaterial({ color: 0x527c32 });
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  instanceCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly getChunk: (cx: number, cz: number) => ChunkData | undefined,
    private readonly seaLevel: number,
    private readonly cosmeticSeed = 0,
  ) {}

  /** Rebuilds the set of vegetated chunks when the player's chunk changes (or a chunk updates). */
  update(px: number, pz: number, force = false): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    if (!force && cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx;
    this.centerZ = cz;
    const wanted = new Set<number>();
    let built = 0;
    for (let dz = -VEG_RADIUS; dz <= VEG_RADIUS; dz++) {
      for (let dx = -VEG_RADIUS; dx <= VEG_RADIUS; dx++) {
        const chunk = this.getChunk(cx + dx, cz + dz);
        if (!chunk || chunk.lod !== 0) continue;
        const key = chunkKey(chunk.cx, chunk.cz);
        wanted.add(key);
        if (!this.perChunk.has(key) && built < 6) {
          this.perChunk.set(key, this.build(chunk));
          built++;
        }
      }
    }
    for (const [key, v] of this.perChunk) {
      if (wanted.has(key)) continue;
      for (const mesh of v) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
      this.perChunk.delete(key);
    }
    // Build remaining chunks over the next frames rather than hitching this one.
    if (built >= 6) this.centerX = Number.NaN;
    this.instanceCount = 0;
    for (const v of this.perChunk.values()) for (const mesh of v) this.instanceCount += mesh.count;
  }

  /** Drops vegetation for a chunk whose data changed (e.g. LOD upgrade). */
  invalidate(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const v = this.perChunk.get(key);
    if (!v) return;
    for (const mesh of v) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.perChunk.delete(key);
    this.centerX = Number.NaN;
  }

  private build(chunk: ChunkData): ChunkVegetation {
    const rng = new Rng(chunk.cosmeticSeed);
    const n = chunk.verts;
    const step = lodStep(chunk.lod);
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const data: Record<Cover, number[]> = {
      grass: [], tufts: [], tall: [], reeds: [], flowers: [], fern: [], bush: [], sapling: [], conifer: [], moss: [],
    };
    // Fit the grid exactly to the chunk; avoid bare strips along its far edges.
    const cells = Math.ceil(CHUNK_SIZE / CELL);
    const cellSize = CHUNK_SIZE / cells;
    for (let gz = 0; gz < cells; gz++) {
      for (let gx = 0; gx < cells; gx++) {
        const lx = (gx + rng.next()) * cellSize;
        const lz = (gz + rng.next()) * cellSize;
        const roll = rng.next();
        const vi = Math.min(n - 1, Math.round(lx / step));
        const vj = Math.min(n - 1, Math.round(lz / step));
        const k = vj * n + vi;
        const surface = chunk.surface[k]! as Surface;
        const y = chunkHeightAtLocal(chunk, lx, lz);
        const wq = chunk.water[k]!;
        if (y < this.seaLevel + 0.15 || (wq && dequantizeHeight(wq) > y - 0.05)) continue;
        const gd = GRASS_DENSITY[surface] ?? 0;
        const fd = FLOWER_DENSITY[surface] ?? 0;
        const humidity = chunk.humidity[k]! / 255;
        const x = ox + lx;
        const z = oz + lz;
        const patch = (size: number, salt: number) => vegetationPatch(x, z, size, this.cosmeticSeed ^ salt);
        const density = patch(18, 0x73);
        const meadow = patch(32, 0x94);
        const reedBed = patch(24, 0xa6);
        const forest = surface === Surface.ForestFloor || surface === Surface.JungleFloor;
        const lush = surface === Surface.Grass || surface === Surface.DryGrass;
        // Skip cliff faces; sample the same triangle heightfield used by the terrain.
        const slope = Math.hypot(
          chunkHeightAtLocal(chunk, Math.min(CHUNK_SIZE, lx + 0.35), lz) - y,
          chunkHeightAtLocal(chunk, lx, Math.min(CHUNK_SIZE, lz + 0.35)) - y,
        ) / 0.35;
        if (slope > 1.25) continue;
        const add = (type: Cover) => data[type].push(x, y, z, rng.next(), k);
        if (gd > 0 && roll < gd * (0.2 + density * 1.1)) {
          if ((lush || surface === Surface.Mud) && reedBed > 0.62 && humidity > 0.4) add('reeds');
          else if (lush && density > 0.58) add('tall');
          else add(density > 0.43 ? 'tufts' : 'grass');
        }
        // Flowers and forest undergrowth coexist with the grass layer.
        if (fd > 0 && rng.next() < (lush && meadow > 0.54 ? 0.65 : fd) * (0.5 + humidity)) add('flowers');
        if ((forest || lush || surface === Surface.Mud) && humidity > 0.48) {
          if (rng.next() < (forest ? 0.09 : 0.018) * density) add('fern');
          if (rng.next() < (forest ? 0.025 : 0.009) * density) add('bush');
          if (forest && rng.next() < 0.004) add(chunk.temperature[k]! < 115 ? 'conifer' : 'sapling');
        }
        if ((forest || surface === Surface.Rock || surface === Surface.Mud) && humidity > 0.5
          && patch(12, 0xb8) > 0.48 && rng.next() < 0.28) add('moss');
      }
    }
    const meshes: ChunkVegetation = [];
    for (const type of COVER_TYPES) {
      const mesh = this.instance(this.geometries[type], type === 'moss' ? this.mossMaterial : this.material, data[type], chunk, type);
      if (mesh) meshes.push(mesh);
    }
    return meshes;
  }

  private instance(
    geo: BufferGeometry,
    mat: MeshLambertMaterial,
    data: number[],
    chunk: ChunkData,
    type: Cover,
  ): InstancedMesh | null {
    const count = data.length / 5;
    if (count === 0) return null;
    const mesh = new InstancedMesh(geo, mat, count);
    mesh.name = `vegetation:${type}`;
    for (let i = 0; i < count; i++) {
      const x = data[i * 5]!;
      const y = data[i * 5 + 1]!;
      const z = data[i * 5 + 2]!;
      const r = data[i * 5 + 3]!;
      const k = data[i * 5 + 4]!;
      const s = type === 'flowers' ? 0.8 + r * 0.9 : 0.75 + r * 0.6;
      const a = r * Math.PI * 2;
      const c = Math.cos(a) * s;
      const sn = Math.sin(a) * s;
      this.m.set(c, 0, sn, x, 0, s, 0, y, -sn, 0, c, z, 0, 0, 0, 1);
      mesh.setMatrixAt(i, this.m);
      if (type === 'flowers') {
        const palette = Math.floor(vegetationPatch(x, z, 22, this.cosmeticSeed ^ 0xca) * FLOWER_COLORS.length);
        this.c.copy(FLOWER_COLORS[(palette + (r > 0.8 ? 1 : 0)) % FLOWER_COLORS.length]!);
      } else if (type === 'fern' || type === 'bush' || type === 'sapling' || type === 'conifer' || type === 'moss') this.c.setRGB(1, 1, 1).multiplyScalar(0.85 + r * 0.3);
      else {
        grassTint(chunk.temperature[k]! / 255, chunk.humidity[k]! / 255, this.c).multiplyScalar(0.85 + r * 0.3);
        if (type === 'reeds') this.c.lerp(REED_TINT, 0.42);
      }
      mesh.setColorAt(i, this.c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1; // Include wind displacement.
    this.scene.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const v of this.perChunk.values()) {
      for (const mesh of v) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    this.perChunk.clear();
    this.instanceCount = 0;
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.material.dispose();
    this.mossMaterial.dispose();
  }
}
