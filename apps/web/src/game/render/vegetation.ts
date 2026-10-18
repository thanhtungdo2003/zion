import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  type Scene,
} from 'three';
import { CHUNK_SIZE, Rng, Surface, chunkKey, dequantizeHeight, lodStep, propTransform, smoothstep, type ChunkData, type WorldInfo, type VegetationCell, type VegetationMessage } from '@zion/shared';
import { grassTint } from './palette';
import { chunkHeightAtLocal } from './terrain';
import { windUniforms, type AssetVisual } from './asset-library';
import { vegetationPatch } from './vegetation-pattern';

/**
 * Ground cover kinds and the prepared grass models drawing each (asset ids 2640–2652): every pack
 * split into its kinds so they can be placed where they belong.
 */
export const COVER_ASSETS = {
  /** Short grass carpet: stylized clumps and blades (weighted: light blades most often), a low patch. */
  carpet: [2643, 2640, 2641, 2642, 2645, 2644],
  /** Fuller grass patches on lush meadows. */
  patch: [2644, 2646],
  /** Taller meadow grass sheets on lush open ground. */
  meadow: [2650],
  /** Wildflowers mixed into the meadow sheets. */
  flowers: [2651],
  /** Full, detailed tufts: at the feet of trees, rocks and buildings. */
  lush: [2647],
  /** The odd big tuft standing out of a carpet. */
  tuft: [2647],
  /** Dry, straw-coloured tufts on dry grassland. */
  dry: [2648],
  /** Reeds along water, in mud and on wet ground. */
  reeds: [2649],
  /** Ferns on forest and jungle floors. */
  ferns: [2652],
} as const;
export type Cover = keyof typeof COVER_ASSETS;
const COVERS = Object.keys(COVER_ASSETS) as Cover[];
export const ALL_COVER_ASSETS: readonly number[] = [...new Set(COVERS.flatMap((c) => COVER_ASSETS[c]))];

/** Grass carpet density per surface (clumps per ~0.8 m cell inside a patch). */
const CARPET: Partial<Record<Surface, number>> = {
  [Surface.Grass]: 1, [Surface.JungleFloor]: .75, [Surface.DryGrass]: .7, [Surface.RoadVerge]: .65,
  [Surface.ForestFloor]: .35, [Surface.Mud]: .25, [Surface.Dirt]: .12, [Surface.Gravel]: .05, [Surface.Sand]: .03,
};
/** Surfaces where grass grows thick around whatever stands on them. */
const GRASSY = new Set<Surface>([Surface.Grass, Surface.DryGrass, Surface.JungleFloor, Surface.RoadVerge, Surface.ForestFloor]);
const CELL = .9;
/** The kinds a grass patch may be made of (one per patch). */
const PATCH_SPECIES = [2643, 2640, 2641, 2642, 2645, 2644];
const VEG_RADIUS = 2;
const MEADOW_MIN_CAMP_DISTANCE = 300;
const MEADOW_FULL_CAMP_DISTANCE = 400;
/** Instance floats: matrix (16), colour (3), cell key, "near only" detail flag. */
const STRIDE = 21;
/** Heavy models (thousands of triangles): only so many per chunk. */
const CAP: Partial<Record<Cover, number>> = { lush: 10, tuft: 12, dry: 14, patch: 40, ferns: 70 };

interface ChunkCover {
  /** Per model (asset id): packed instances (see STRIDE). */
  byAsset: Map<number, Float32Array>;
}

function windMaterial(base: Material): Material {
  const mat = base.clone();
  (mat as Material & { alphaTest: number }).alphaTest = Math.max(.35, (base as Material & { alphaTest?: number }).alphaTest ?? 0);
  mat.side = 2;
  const compile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float sway = min(max(position.y, 0.0) * 0.9, 0.35) * min(max(position.y, 0.0), 1.0);
        float w = sin(uTime * 1.9 + iOrigin.x * 0.35 + iOrigin.z * 0.27) + 0.5 * sin(uTime * 3.7 + iOrigin.x * 0.9);
        transformed.x += w * sway * 0.35;
        transformed.z += w * sway * 0.14;`);
  };
  mat.customProgramCacheKey = () => `ground-cover-${base.uuid}`;
  return mat;
}

/**
 * Ground cover around the player, drawn with the game's grass models. Purely visual: scattered on
 * the client from the server-sent surface, height, humidity and props with the chunk's cosmetic
 * seed (every client sees the same grass). Each model is one instanced mesh for the whole area, so
 * dense carpets cost a handful of draw calls; the nearest chunks get the full detail.
 */
export class VegetationRenderer {
  private readonly perChunk = new Map<number, ChunkCover>();
  private readonly damage = new Map<number, Map<number, VegetationCell>>();
  private readonly coverCells = new Map<number, Set<number>>();
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly materials = new Map<Material, Material>();
  private readonly visuals = new Map<number, AssetVisual>();
  private nextFireAt = 0;
  private readonly c = new Color();
  private readonly white = new Color(1, 1, 1);
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private dirty = false;
  instanceCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly getChunk: (cx: number, cz: number) => ChunkData | undefined,
    private readonly seaLevel: number,
    private readonly cosmeticSeed = 0,
    private readonly camp: WorldInfo['camp'] = null,
    /** The grass models (loaded by the asset library). */
    private readonly models: { get(id: number): AssetVisual | undefined; load(id: number): Promise<AssetVisual> | undefined } | null = null,
    /** Footprint radius of a placed prop (m, at scale 1): grass gathers around it. */
    private readonly propRadius: (asset: number) => number = () => 0,
  ) {
    for (const id of ALL_COVER_ASSETS) void models?.load(id)?.then((v) => { this.visuals.set(id, v); if (this.visuals.size === ALL_COVER_ASSETS.length) { this.centerX = Number.NaN; this.dirty = true; } });
  }

  private get ready(): boolean { return !this.models || this.visuals.size === ALL_COVER_ASSETS.length; }

  private density = 1;
  private radius = VEG_RADIUS;
  /** Graphics setting: grass density (0…1) and how many chunks around the player get cover. */
  setQuality(density: number, radius: number): void {
    if (density === this.density && radius === this.radius) return;
    this.density = density; this.radius = radius;
    this.perChunk.clear(); this.coverCells.clear();
    this.centerX = Number.NaN;
    this.dirty = true;
  }

  /** All ground cover around the player is built. */
  get settled(): boolean { return !Number.isNaN(this.centerX); }

  /** Rebuilds the set of vegetated chunks when the player's chunk changes (or a chunk updates). */
  update(px: number, pz: number, force = false, deadline = Infinity): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    if (!force && cx === this.centerX && cz === this.centerZ && !this.dirty) return;
    if (!this.ready) return;
    const moved = cx !== this.centerX || cz !== this.centerZ;
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
    let changed = moved;
    for (const key of [...this.perChunk.keys()]) if (!wanted.has(key)) { this.perChunk.delete(key); this.coverCells.delete(key); changed = true; }
    // Nearest first, at most one chunk per frame, sharing the terrain build budget.
    missing.sort((a, b) => (a.cx - cx) ** 2 + (a.cz - cz) ** 2 - (b.cx - cx) ** 2 - (b.cz - cz) ** 2);
    for (const chunk of missing) {
      if (built === 1 || performance.now() >= deadline) break;
      this.perChunk.set(chunkKey(chunk.cx, chunk.cz), this.build(chunk));
      built++;
      changed = true;
    }
    if (built < missing.length) this.centerX = Number.NaN;
    if (changed || this.dirty) this.upload();
    this.dirty = false;
  }

  /** Drops vegetation for a chunk whose data changed (e.g. LOD upgrade or felled trees). */
  invalidate(cx: number, cz: number): void {
    this.centerX = Number.NaN;
    const key = chunkKey(cx, cz);
    if (this.perChunk.delete(key)) this.dirty = true;
    this.coverCells.delete(key);
  }

  private build(chunk: ChunkData): ChunkCover {
    const cells = new Set<number>();
    this.coverCells.set(chunkKey(chunk.cx, chunk.cz), cells);
    const rng = new Rng(chunk.cosmeticSeed);
    const n = chunk.verts, step = lodStep(chunk.lod), ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const out = new Map<number, number[]>();
    const sample = (lx: number, lz: number) => {
      const vi = Math.min(n - 1, Math.max(0, Math.round(lx / step))), vj = Math.min(n - 1, Math.max(0, Math.round(lz / step)));
      return vj * n + vi;
    };
    const dry = (y: number, k: number) => {
      if (y < this.seaLevel + .15) return false;
      const wq = chunk.water[k]!;
      return !(wq && dequantizeHeight(wq) > y - .05);
    };
    const slopeAt = (lx: number, lz: number, y: number) => Math.hypot(
      chunkHeightAtLocal(chunk, Math.min(CHUNK_SIZE, lx + .35), lz) - y,
      chunkHeightAtLocal(chunk, lx, Math.min(CHUNK_SIZE, lz + .35)) - y,
    ) / .35;
    const used = new Map<Cover, number>();
    const add = (cover: Cover, lx: number, lz: number, k: number, scale: number, detail: boolean, only?: number) => {
      const cap = CAP[cover];
      if (cap !== undefined) { const n = used.get(cover) ?? 0; if (n >= cap) return; used.set(cover, n + 1); }
      const list = COVER_ASSETS[cover], asset = only ?? list[Math.floor(rng.next() * list.length)]!;
      const x = ox + lx, z = oz + lz, y = chunkHeightAtLocal(chunk, lx, lz) - .03;
      const a = rng.next() * Math.PI * 2, c = Math.cos(a) * scale, s = Math.sin(a) * scale;
      // Tint: the local climate over the model's own colours (dry and cold grass yellows).
      if (cover === 'flowers' || cover === 'dry') this.c.copy(this.white);
      else this.c.copy(this.white).lerp(grassTint(chunk.temperature[k]! / 255, chunk.humidity[k]! / 255, new Color()).multiplyScalar(1.9), .38);
      this.c.multiplyScalar(.88 + rng.next() * .22);
      const cell = Math.floor(lz) * CHUNK_SIZE + Math.floor(lx);
      cells.add(cell);
      let arr = out.get(asset);
      if (!arr) out.set(asset, (arr = []));
      arr.push(c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, y, z, 1, this.c.r, this.c.g, this.c.b, cell, detail ? 1 : 0);
    };
    const cellCount = Math.ceil(CHUNK_SIZE / CELL), cellSize = CHUNK_SIZE / cellCount;
    for (let gz = 0; gz < cellCount; gz++) {
      for (let gx = 0; gx < cellCount; gx++) {
        const lx = (gx + rng.next()) * cellSize, lz = (gz + rng.next()) * cellSize;
        const k = sample(lx, lz), surface = chunk.surface[k]! as Surface, y = chunkHeightAtLocal(chunk, lx, lz);
        if (!dry(y, k)) continue;
        const wet = chunk.humidity[k]! / 255, warm = chunk.temperature[k]! / 255;
        const x = ox + lx, z = oz + lz;
        const patch = (size: number, salt: number) => vegetationPatch(x, z, size, this.cosmeticSeed ^ salt);
        if (slopeAt(lx, lz, y) > 1.25) continue;
        const base = CARPET[surface] ?? 0;
        // Reeds: low wet ground by the water and in mud, in stands.
        const nearWater = chunk.water[k] ? dequantizeHeight(chunk.water[k]!) > y - 1.6 : y < this.seaLevel + 1.2;
        if ((nearWater || surface === Surface.Mud || (wet > .78 && surface === Surface.JungleFloor)) && patch(9, 0x4e) > .45 && rng.next() < .55 * this.density) {
          add('reeds', lx, lz, k, .8 + rng.next() * .5, false);
          continue;
        }
        if (base <= 0) continue;
        // Grass grows in patches: a dense carpet inside, a few stray clumps between.
        const shape = patch(16, 0x73) * .65 + patch(5, 0x5a) * .35;
        const inside = smoothstep(.3, .48, shape);
        // Each patch is one kind of grass (neighbouring patches differ).
        const species = PATCH_SPECIES[Math.min(PATCH_SPECIES.length - 1, Math.floor(patch(26, 0x5e) * PATCH_SPECIES.length))]!;
        const lush = surface === Surface.Grass || surface === Surface.RoadVerge || surface === Surface.JungleFloor;
        const forest = surface === Surface.ForestFloor || surface === Surface.JungleFloor;
        // Ferns carpet the forest floor in shade.
        if (forest && patch(11, 0xfe) > .6 && rng.next() < .14 * this.density) { add('ferns', lx, lz, k, 1 + rng.next() * .6, false); continue; }
        const clumps = inside > .55 ? 3 : inside > .2 ? 2 : inside > 0 ? 1 : 0;
        for (let i = 0; i < clumps; i++) {
          if (rng.next() > Math.min(1, base * (.8 + inside * .6)) * this.density) continue;
          const jx = Math.min(CHUNK_SIZE - .01, Math.max(0, lx + (rng.next() - .5) * cellSize)), jz = Math.min(CHUNK_SIZE - .01, Math.max(0, lz + (rng.next() - .5) * cellSize));
          // The far ring keeps every other clump; the near chunks get them all.
          // Now and then a big tuft stands out of the carpet.
          if (inside > .5 && rng.next() < .012) add('tuft', jx, jz, k, .9 + rng.next() * .4, false);
          else add(surface === Surface.DryGrass && rng.next() < .02 ? 'dry' : 'carpet', jx, jz, k, .85 + rng.next() * .5, i > 0, species);
        }
        if (!clumps && rng.next() < base * .03 * this.density) add('carpet', lx, lz, k, .7 + rng.next() * .4, false, species);
        // Meadows: tall grass and wildflowers in open, lush, humid fields away from the camp.
        if (lush && inside > .5) {
          const meadow = patch(54, 0x94);
          const campDistance = this.camp ? Math.hypot(Math.max(0, Math.abs(x - this.camp.x) - this.camp.halfSize), Math.max(0, Math.abs(z - this.camp.z) - this.camp.halfSize)) : Infinity;
          const remote = smoothstep(MEADOW_MIN_CAMP_DISTANCE * .25, MEADOW_FULL_CAMP_DISTANCE * .25, campDistance);
          if (meadow > .62 && rng.next() < .05 * remote * this.density) add('meadow', lx, lz, k, .8 + rng.next() * .5, false);
          else if (meadow > .5 && rng.next() < .03 * this.density) add('patch', lx, lz, k, .9 + rng.next() * .5, true);
          if (meadow > .72 && wet > .35 && warm > .3 && rng.next() < .045 * remote * this.density * (.6 + wet)) add('flowers', lx, lz, k, .7 + rng.next() * .5, false);
        }
      }
    }
    // Grass gathers at the feet of trees, rocks, ruins and walls standing on grassy ground.
    for (const p of chunk.props) {
      const r0 = this.propRadius(p.asset);
      if (r0 <= 0) continue;
      const t = propTransform(chunk, p), lx0 = t.x - ox, lz0 = t.z - oz;
      if (lx0 < 0 || lz0 < 0 || lx0 >= CHUNK_SIZE || lz0 >= CHUNK_SIZE) continue;
      const k0 = sample(lx0, lz0);
      if (!GRASSY.has(chunk.surface[k0]! as Surface)) continue;
      const r = Math.min(6, r0 * t.scale);
      const count = Math.min(14, Math.round((4 + r * 3) * this.density));
      for (let i = 0; i < count; i++) {
        const a = rng.next() * Math.PI * 2, d = r * (.45 + rng.next() * .5) + .3;
        const lx = lx0 + Math.cos(a) * d, lz = lz0 + Math.sin(a) * d;
        if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) continue;
        const k = sample(lx, lz), y = chunkHeightAtLocal(chunk, lx, lz);
        if (!GRASSY.has(chunk.surface[k]! as Surface) || !dry(y, k)) continue;
        add(i === 0 && r > 1.2 ? 'lush' : 'carpet', lx, lz, k, .9 + rng.next() * .5, false);
      }
    }
    return { byAsset: new Map([...out].map(([a, v]) => [a, new Float32Array(v)])) };
  }

  /** Concatenates every vegetated chunk into one instanced mesh per model part. */
  private upload(): void {
    const near = (key: number) => Math.max(Math.abs((key >> 16) - this.centerX), Math.abs(((key << 16) >> 16) - this.centerZ)) <= 1;
    const totals = new Map<number, number>();
    for (const [key, cover] of this.perChunk) {
      const close = Number.isNaN(this.centerX) || near(key);
      for (const [asset, arr] of cover.byAsset) {
        let n = 0;
        for (let i = 0; i < arr.length; i += STRIDE) if (close || arr[i + 20] === 0) n++;
        totals.set(asset, (totals.get(asset) ?? 0) + n);
      }
    }
    const used = new Set<string>();
    this.instanceCount = 0;
    for (const [asset, total] of totals) {
      const visual = this.visuals.get(asset);
      const parts = visual?.parts ?? [];
      parts.forEach((part, pi) => {
        const id = `${asset}:${pi}`;
        used.add(id);
        let mesh = this.meshes.get(id);
        if (!mesh || mesh.instanceMatrix.count < total) {
          if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
          const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, total))));
          let mat = this.materials.get(part.material);
          if (!mat) this.materials.set(part.material, (mat = windMaterial(part.material)));
          mesh = new InstancedMesh(part.geometry, mat, capacity);
          mesh.name = `vegetation:${asset}`;
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
          mesh.frustumCulled = false;
          mesh.receiveShadow = true;
          mesh.userData.cells = new Int32Array(capacity);
          mesh.userData.chunks = new Int32Array(capacity);
          mesh.userData.matrices = new Float32Array(capacity * 16);
          this.meshes.set(id, mesh);
          this.scene.add(mesh);
        }
        const matrices = mesh.instanceMatrix.array as Float32Array, colors = mesh.instanceColor!.array as Float32Array;
        const cellsOut = mesh.userData.cells as Int32Array, chunksOut = mesh.userData.chunks as Int32Array, originals = mesh.userData.matrices as Float32Array;
        let i = 0;
        for (const [key, cover] of this.perChunk) {
          const arr = cover.byAsset.get(asset);
          if (!arr) continue;
          const close = Number.isNaN(this.centerX) || near(key);
          const damage = this.damage.get(key);
          for (let o = 0; o < arr.length; o += STRIDE) {
            if (!close && arr[o + 20] !== 0) continue;
            originals.set(arr.subarray(o, o + 16), i * 16);
            if (damage?.has(arr[o + 19]!)) { matrices.fill(0, i * 16, i * 16 + 15); matrices[i * 16 + 12] = arr[o + 12]!; matrices[i * 16 + 13] = arr[o + 13]!; matrices[i * 16 + 14] = arr[o + 14]!; matrices[i * 16 + 15] = 1; }
            else matrices.set(arr.subarray(o, o + 16), i * 16);
            colors[i * 3] = arr[o + 16]!; colors[i * 3 + 1] = arr[o + 17]!; colors[i * 3 + 2] = arr[o + 18]!;
            cellsOut[i] = arr[o + 19]!; chunksOut[i] = key;
            i++;
          }
        }
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        this.instanceCount += i;
      });
    }
    for (const [id, mesh] of this.meshes) if (!used.has(id)) { mesh.count = 0; }
  }

  /** Apply server state (burnt / blasted cells) without rebuilding the deterministic scatter. */
  applyDamage(message: VegetationMessage): void {
    if (message.reset) this.damage.clear();
    for (const chunk of message.chunks) {
      const key = chunkKey(chunk.cx, chunk.cz);
      if (chunk.cells.length) this.damage.set(key, new Map(chunk.cells.map((cell) => [cell[1] * CHUNK_SIZE + cell[0], cell])));
      else this.damage.delete(key);
    }
    // Hide / restore in place: the instance arrays keep each plant's original transform.
    for (const mesh of this.meshes.values()) {
      const cells = mesh.userData.cells as Int32Array, chunks = mesh.userData.chunks as Int32Array, originals = mesh.userData.matrices as Float32Array;
      const matrices = mesh.instanceMatrix.array as Float32Array;
      let changed = false;
      for (let i = 0; i < mesh.count; i++) {
        const hidden = !!this.damage.get(chunks[i]!)?.has(cells[i]!);
        const zero = matrices[i * 16] === 0 && matrices[i * 16 + 5] === 0;
        if (hidden === zero) continue;
        if (hidden) { matrices.fill(0, i * 16, i * 16 + 12); }
        else matrices.set(originals.subarray(i * 16, i * 16 + 16), i * 16);
        changed = true;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
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
    for (const mesh of this.meshes.values()) { this.scene.remove(mesh); mesh.dispose(); }
    this.meshes.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.perChunk.clear();
    this.coverCells.clear();
    this.damage.clear();
    this.instanceCount = 0;
  }
}
