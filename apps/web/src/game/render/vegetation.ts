import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  DynamicDrawUsage,
  Vector3,
  type Scene,
} from 'three';
import { CHUNK_SIZE, Rng, Surface, chunkKey, dequantizeHeight, lodStep, smoothstep, type ChunkData, type WorldInfo, type VegetationCell, type VegetationMessage } from '@zion/shared';
import { FLOWER_COLORS, grassTint } from './palette';
import { chunkHeightAtLocal } from './terrain';
import { windUniforms } from './asset-library';
import { vegetationPatch } from './vegetation-pattern';

/** Grass density per surface (instances per ~1.2 m cell). */
const GRASS_DENSITY: Partial<Record<Surface, number>> = {
  [Surface.Grass]: 0.55,
  [Surface.JungleFloor]: 0.5,
  [Surface.DryGrass]: 0.4,
  [Surface.ForestFloor]: 0.2,
  [Surface.Mud]: 0.18,
  [Surface.Dirt]: 0.06,
  [Surface.Sand]: 0.02,
  [Surface.Gravel]: 0.03,
  [Surface.RoadVerge]: 0.38,
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
const MEADOW_MIN_CAMP_DISTANCE = 300;
const MEADOW_FULL_CAMP_DISTANCE = 400;
const MEADOW_THRESHOLD = 0.82;

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

type Cover = 'grass' | 'tufts' | 'tall' | 'reeds' | 'flowers';
const COVER_TYPES: readonly Cover[] = ['grass', 'tufts', 'tall', 'reeds', 'flowers'];
type ChunkVegetation = Array<InstancedMesh>;
const DESTRUCTIBLE = new Set<Cover>(['grass', 'tufts', 'tall', 'reeds', 'flowers']);

/**
 * Cosmetic ground cover for chunks near the player. Purely visual and gameplay-irrelevant, so it
 * is scattered on the client from the server-sent biome/surface/height data with the chunk's
 * cosmetic seed (deterministic: every client sees the same grass).
 */
export class VegetationRenderer {
  private readonly perChunk = new Map<number, ChunkVegetation>();
  private readonly damage = new Map<number, Map<number, VegetationCell>>();
  private readonly coverCells = new Map<number, Set<number>>();
  private readonly originals = new Map<InstancedMesh, { matrices: Float32Array; hidden: Uint8Array }>();
  private readonly zeroScale = new Vector3(0, 0, 0);
  private nextFireAt = 0;
  private readonly geometries: Record<Cover, BufferGeometry> = {
    grass: bladeClump(),
    tufts: bladeClump(12, 1.25, 1.3),
    tall: bladeClump(9, 2.8, 0.8),
    reeds: bladeClump(10, 4.5, 0.7, true),
    flowers: flowerGeometry(),
  };
  private readonly material = windMaterial();
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
    private readonly camp: WorldInfo['camp'] = null,
  ) {}

  private density = 1;
  private radius = VEG_RADIUS;
  /** Graphics setting: grass density (0…1) and how many chunks around the player get cover. */
  setQuality(density: number, radius: number): void {
    if (density === this.density && radius === this.radius) return;
    this.density = density; this.radius = radius;
    for (const [key, v] of this.perChunk) {
      for (const mesh of v) { this.scene.remove(mesh); this.originals.delete(mesh); mesh.dispose(); }
      this.perChunk.delete(key); this.coverCells.delete(key);
    }
    this.centerX = Number.NaN;
  }

  /** All ground cover around the player is built. */
  get settled(): boolean { return !Number.isNaN(this.centerX); }

  /** Rebuilds the set of vegetated chunks when the player's chunk changes (or a chunk updates). */
  update(px: number, pz: number, force = false, deadline = Infinity): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    if (!force && cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx;
    this.centerZ = cz;
    const wanted = new Set<number>();
    const missing: ChunkData[] = [];
    let built = 0;
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const chunk = this.getChunk(cx + dx, cz + dz);
        if (!chunk || chunk.lod !== 0) continue;
        const key = chunkKey(chunk.cx, chunk.cz);
        wanted.add(key);
        if (!this.perChunk.has(key)) missing.push(chunk);
      }
    }
    for (const [key, v] of this.perChunk) {
      if (wanted.has(key)) continue;
      for (const mesh of v) {
        this.scene.remove(mesh);
        this.originals.delete(mesh);
        mesh.dispose();
      }
      this.perChunk.delete(key);
      this.coverCells.delete(key);
    }
    // Nearest first, at most one upload per frame, sharing the terrain build budget.
    missing.sort((a, b) => (a.cx - cx) ** 2 + (a.cz - cz) ** 2 - (b.cx - cx) ** 2 - (b.cz - cz) ** 2);
    for (const chunk of missing) {
      if (built === 1 || performance.now() >= deadline) break;
      this.perChunk.set(chunkKey(chunk.cx, chunk.cz), this.build(chunk));
      built++;
    }
    if (built < missing.length) this.centerX = Number.NaN;
    this.instanceCount = 0;
    for (const v of this.perChunk.values()) for (const mesh of v) this.instanceCount += mesh.count;
  }

  /** Drops vegetation for a chunk whose data changed (e.g. LOD upgrade). */
  invalidate(cx: number, cz: number): void {
    this.centerX = Number.NaN;
    const key = chunkKey(cx, cz);
    const v = this.perChunk.get(key);
    if (!v) return;
    for (const mesh of v) {
      this.scene.remove(mesh);
      this.originals.delete(mesh);
      mesh.dispose();
    }
    this.perChunk.delete(key);
    this.coverCells.delete(key);
  }

  private build(chunk: ChunkData): ChunkVegetation {
    this.coverCells.set(chunkKey(chunk.cx, chunk.cz), new Set());
    const rng = new Rng(chunk.cosmeticSeed);
    const n = chunk.verts;
    const step = lodStep(chunk.lod);
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const data: Record<Cover, number[]> = {
      grass: [], tufts: [], tall: [], reeds: [], flowers: [],
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
        // Larger, rarer patches keep flower fields as occasional discoveries.
        const meadow = patch(64, 0x94);
        const lush = surface === Surface.Grass || surface === Surface.DryGrass || surface === Surface.RoadVerge;
        // Skip cliff faces; sample the same triangle heightfield used by the terrain.
        const slope = Math.hypot(
          chunkHeightAtLocal(chunk, Math.min(CHUNK_SIZE, lx + 0.35), lz) - y,
          chunkHeightAtLocal(chunk, lx, Math.min(CHUNK_SIZE, lz + 0.35)) - y,
        ) / 0.35;
        if (slope > 1.25) continue;
        const add = (type: Cover, ox = 0, oz = 0) => data[type].push(x + ox, y, z + oz, rng.next(), k);
        // Grass grows in patches: dense clumps packed together inside a patch (several per
        // cell, fuller towards its middle), only a few stray blades on the bare ground between.
        const shape = patch(14, 0x73) * .7 + patch(5, 0x5a) * .3;
        const inside = smoothstep(.5, .66, shape);
        if (gd > 0 && inside > 0) {
          const clumps = inside > .75 ? 3 : inside > .35 ? 2 : 1;
          for (let i = 0; i < clumps; i++) {
            if (rng.next() > Math.min(1, gd * 1.6 + .25) * this.density) continue;
            const ox = (rng.next() - .5) * cellSize, oz = (rng.next() - .5) * cellSize;
            if (lush && inside > .8 && density > .55) add('tall', ox, oz);
            else add(inside > .45 ? 'tufts' : 'grass', ox, oz);
          }
        } else if (gd > 0 && roll < gd * this.density * .05) add('grass');
        // Flowers and forest undergrowth coexist with the grass layer.
        let flowerDensity = fd;
        if (lush && meadow > MEADOW_THRESHOLD) {
          // Distance to the square camp's perimeter, including its corners.
          const campDistance = this.camp ? Math.hypot(
            Math.max(0, Math.abs(x - this.camp.x) - this.camp.halfSize),
            Math.max(0, Math.abs(z - this.camp.z) - this.camp.halfSize),
          ) : Infinity;
          const remoteness = smoothstep(MEADOW_MIN_CAMP_DISTANCE, MEADOW_FULL_CAMP_DISTANCE, campDistance);
          const edge = smoothstep(MEADOW_THRESHOLD, MEADOW_THRESHOLD + 0.06, meadow);
          flowerDensity += (0.65 - fd) * remoteness * edge;
        }
        if (fd > 0 && rng.next() < flowerDensity * this.density * (0.5 + humidity)) add('flowers');
      }
    }
    const meshes: ChunkVegetation = [];
    for (const type of COVER_TYPES) {
      const mesh = this.instance(this.geometries[type], this.material, data[type], chunk, type);
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
      } else {
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
    if (DESTRUCTIBLE.has(type)) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      const matrices = (mesh.instanceMatrix.array as Float32Array).slice();
      this.originals.set(mesh, { matrices, hidden: new Uint8Array(count) });
      const cells = this.coverCells.get(chunkKey(chunk.cx, chunk.cz))!;
      for (let i = 0; i < count; i++) {
        const lx = Math.floor(matrices[i * 16 + 12]! - chunk.cx * CHUNK_SIZE);
        const lz = Math.floor(matrices[i * 16 + 14]! - chunk.cz * CHUNK_SIZE);
        cells.add(lz * CHUNK_SIZE + lx);
      }
      this.mask(mesh, chunk.cx, chunk.cz);
    }
    this.scene.add(mesh);
    return mesh;
  }

  /** Apply server state without rebuilding deterministic scatter or its GPU geometries. */
  applyDamage(message: VegetationMessage): void {
    const changed = new Set<number>();
    if (message.reset) {
      for (const key of this.damage.keys()) changed.add(key);
      this.damage.clear();
    }
    for (const chunk of message.chunks) {
      const key = chunkKey(chunk.cx, chunk.cz);
      changed.add(key);
      if (chunk.cells.length) this.damage.set(key, new Map(chunk.cells.map((cell) => [cell[1] * CHUNK_SIZE + cell[0], cell])));
      else this.damage.delete(key);
    }
    for (const key of changed) {
      const cx = key >> 16;
      const cz = (key << 16) >> 16;
      for (const mesh of this.perChunk.get(key) ?? []) this.mask(mesh, cx, cz);
    }
  }

  private mask(mesh: InstancedMesh, cx: number, cz: number): void {
    const original = this.originals.get(mesh);
    if (!original) return;
    const damage = this.damage.get(chunkKey(cx, cz));
    let changed = false;
    for (let i = 0; i < mesh.count; i++) {
      const offset = i * 16;
      const lx = Math.floor(original.matrices[offset + 12]! - cx * CHUNK_SIZE);
      const lz = Math.floor(original.matrices[offset + 14]! - cz * CHUNK_SIZE);
      const hidden = damage?.has(lz * CHUNK_SIZE + lx) ? 1 : 0;
      if (original.hidden[i] === hidden) continue;
      original.hidden[i] = hidden;
      this.m.fromArray(original.matrices, offset);
      if (hidden) this.m.scale(this.zeroScale);
      mesh.setMatrixAt(i, this.m);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bounded, frame-rate-independent fire emission only on visible damaged plants. */
  emitBurning(now: number, emit: (x: number, y: number, z: number) => void): void {
    if (now < this.nextFireAt) return;
    this.nextFireAt = now + 100;
    let budget = 24;
    for (const [key, cells] of this.damage) {
      const occupied = this.coverCells.get(key);
      if (!occupied) continue;
      const cx = key >> 16;
      const cz = (key << 16) >> 16;
      for (const [cellKey, cell] of cells) {
        if (cell[3] <= now || !occupied.has(cellKey) || Math.random() > 0.3) continue;
        emit(cx * CHUNK_SIZE + cell[0] + 0.5, cell[2], cz * CHUNK_SIZE + cell[1] + 0.5);
        if (--budget <= 0) return;
      }
    }
  }

  dispose(): void {
    for (const v of this.perChunk.values()) {
      for (const mesh of v) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    this.perChunk.clear();
    this.originals.clear();
    this.coverCells.clear();
    this.damage.clear();
    this.instanceCount = 0;
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.material.dispose();
  }
}
