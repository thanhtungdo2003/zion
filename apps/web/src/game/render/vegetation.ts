import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type Scene,
} from 'three';
import { CHUNK_SIZE, Rng, Surface, chunkKey, dequantizeHeight, lodStep, type ChunkData } from '@zion/shared';
import { FLOWER_COLORS, grassTint } from './palette';
import { chunkHeightAtLocal } from './terrain';
import { windUniforms } from './asset-library';

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
const CELL = 1.25;
const VEG_RADIUS = 2; // chunks around the player

function bladeClump(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const rng = new Rng(77);
  for (let b = 0; b < 6; b++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.35;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.22 + rng.next() * 0.26;
    const w = 0.035;
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
  const stem = 0.24;
  // Stem.
  push(-0.01, 0, 0, 0.3, 0.5, 0.2);
  push(0.01, 0, 0, 0.3, 0.5, 0.2);
  push(0, stem, 0, 0.3, 0.5, 0.2);
  // Petal cross (white vertex colour, tinted per instance).
  const s = 0.035;
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    push(-s * ax, stem - s, -s * az, 1, 1, 1);
    push(s * ax, stem - s, s * az, 1, 1, 1);
    push(s * ax, stem + s, s * az, 1, 1, 1);
    push(-s * ax, stem - s, -s * az, 1, 1, 1);
    push(s * ax, stem + s, s * az, 1, 1, 1);
    push(-s * ax, stem + s, -s * az, 1, 1, 1);
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
        float sway = position.y * position.y * 0.35;
        float w = sin(uTime * 1.9 + iOrigin.x * 0.35 + iOrigin.z * 0.27) + 0.5 * sin(uTime * 3.7 + iOrigin.x * 0.9);
        transformed.x += w * sway;
        transformed.z += w * sway * 0.4;`,
      );
  };
  mat.customProgramCacheKey = () => 'grass-wind';
  return mat;
}

interface ChunkVegetation {
  grass: InstancedMesh | null;
  flowers: InstancedMesh | null;
}

/**
 * Cosmetic ground cover for chunks near the player. Purely visual and gameplay-irrelevant, so it
 * is scattered on the client from the server-sent biome/surface/height data with the chunk's
 * cosmetic seed (deterministic: every client sees the same grass).
 */
export class VegetationRenderer {
  private readonly perChunk = new Map<number, ChunkVegetation>();
  private readonly grassGeo = bladeClump();
  private readonly flowerGeo = flowerGeometry();
  private readonly grassMat = windMaterial();
  private readonly flowerMat = windMaterial();
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  instanceCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly getChunk: (cx: number, cz: number) => ChunkData | undefined,
    private readonly seaLevel: number,
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
      for (const mesh of [v.grass, v.flowers]) if (mesh) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
      this.perChunk.delete(key);
    }
    // Build remaining chunks over the next frames rather than hitching this one.
    if (built >= 6) this.centerX = Number.NaN;
    this.instanceCount = 0;
    for (const v of this.perChunk.values()) this.instanceCount += (v.grass?.count ?? 0) + (v.flowers?.count ?? 0);
  }

  /** Drops vegetation for a chunk whose data changed (e.g. LOD upgrade). */
  invalidate(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const v = this.perChunk.get(key);
    if (!v) return;
    for (const mesh of [v.grass, v.flowers]) if (mesh) {
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
    const grass: number[] = [];
    const flowers: number[] = [];
    const cells = Math.floor(CHUNK_SIZE / CELL);
    for (let gz = 0; gz < cells; gz++) {
      for (let gx = 0; gx < cells; gx++) {
        const lx = (gx + rng.next()) * CELL;
        const lz = (gz + rng.next()) * CELL;
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
        if (roll < fd * (0.5 + chunk.humidity[k]! / 255)) flowers.push(ox + lx, y, oz + lz, rng.next(), k);
        else if (roll < gd) grass.push(ox + lx, y, oz + lz, rng.next(), k);
      }
    }
    return {
      grass: this.instance(this.grassGeo, this.grassMat, grass, chunk, false),
      flowers: this.instance(this.flowerGeo, this.flowerMat, flowers, chunk, true),
    };
  }

  private instance(
    geo: BufferGeometry,
    mat: MeshLambertMaterial,
    data: number[],
    chunk: ChunkData,
    flower: boolean,
  ): InstancedMesh | null {
    const count = data.length / 5;
    if (count === 0) return null;
    const mesh = new InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const x = data[i * 5]!;
      const y = data[i * 5 + 1]!;
      const z = data[i * 5 + 2]!;
      const r = data[i * 5 + 3]!;
      const k = data[i * 5 + 4]!;
      const s = flower ? 0.8 + r * 0.5 : 0.75 + r * 0.6;
      const a = r * Math.PI * 2;
      const c = Math.cos(a) * s;
      const sn = Math.sin(a) * s;
      this.m.set(c, 0, sn, x, 0, s, 0, y, -sn, 0, c, z, 0, 0, 0, 1);
      mesh.setMatrixAt(i, this.m);
      if (flower) this.c.copy(FLOWER_COLORS[Math.floor(r * 997) % FLOWER_COLORS.length]!);
      else grassTint(chunk.temperature[k]! / 255, chunk.humidity[k]! / 255, this.c).multiplyScalar(0.85 + r * 0.3);
      mesh.setColorAt(i, this.c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const v of this.perChunk.values()) {
      for (const mesh of [v.grass, v.flowers]) if (mesh) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    this.perChunk.clear();
  }
}
