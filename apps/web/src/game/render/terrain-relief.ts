import { BufferAttribute, BufferGeometry, Mesh, type Material, type MeshStandardMaterial, type Scene } from 'three';
import { CHUNK_SIZE, chunkKey, type ChunkData } from '@zion/shared';
import { terrainCellIndices } from '@zion/physics';
import { buildTerrainGeometry, chunkHeightAtLocal } from './terrain';
import { GROUND_LAYER_COUNT, GROUND_RELIEF, GROUND_TILES } from './ground-textures';

/**
 * Real relief round the player, from the ground textures themselves. The terrain mesh has one
 * vertex a metre: rock slopes whose textures show ledges, cracks and stones stayed flat in 3D.
 * Here the chunks round the camera are rebuilt four times as dense and every vertex is pushed
 * out along the ground's normal by the height maps of the texture layers it is made of (the same
 * maps, projections and tiling the ground shader draws with), most on rock, little on soil, none
 * on roads — so the bumps are where the texture shows them, in the silhouette and the light
 * (displacement mapping on a near-field mesh, as engines do with tessellation). The relief eases
 * to nothing at the edge of the area, where the ordinary terrain (hidden inside it) takes over.
 * Collision is the ordinary heightfield.
 */

const RING = 1;
/** Fade the relief out over this many metres at the area's edge. */
const EDGE = 3;
const ATTRS = ['color', 'groundA', 'groundB', 'groundC', 'terrainDetail'] as const;

/** Shared with the terrain shader: the area where the relief replaces the plain terrain. */
export const reliefUniforms = { uReliefRect: { value: [0, 0, -1, -1] as number[] } };

/** The plain terrain is not drawn where the relief is (the relief mesh carries `aRelief` = 1). */
export function applyReliefToGround(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    Object.assign(shader.uniforms, reliefUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRelief;\nvarying float vRelief;\nvarying vec2 vReliefXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRelief = aRelief;\nvReliefXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uReliefRect;\nvarying float vRelief;\nvarying vec2 vReliefXZ;')
      .replace('void main() {', `void main() {
        if (vRelief < 0.5 && vReliefXZ.x > uReliefRect.x && vReliefXZ.y > uReliefRect.y && vReliefXZ.x < uReliefRect.z && vReliefXZ.y < uReliefRect.w) discard;`);
  };
  material.customProgramCacheKey = () => `${key()}|relief-1`;
}

export interface ReliefHeights { data: Uint8Array; size: number }

export class TerrainRelief {
  private readonly meshes = new Map<number, Mesh>();
  /** The area being built (chunks), and the one shown. */
  private block: { cx: number; cz: number } | null = null;
  private shown: { cx: number; cz: number } | null = null;
  private pending: Map<number, Mesh> = new Map();
  private queue: Array<[number, number]> = [];
  enabled = true;
  /** Vertices per metre along each side (4: 25 cm). */
  density = 4;

  constructor(
    private readonly scene: Scene,
    private readonly material: Material,
    private readonly getChunk: (cx: number, cz: number) => ChunkData | undefined,
    private readonly heights: () => ReliefHeights | null,
    private readonly seaLevel: number,
    private readonly cosmeticSeed: number,
  ) {}

  /** A chunk changed (its data or level of detail): the relief over it is rebuilt. */
  invalidate(cx: number, cz: number): void {
    if (!this.shown || Math.abs(cx - this.shown.cx) > RING || Math.abs(cz - this.shown.cz) > RING) return;
    this.block = null;
  }

  /** Builds at most one chunk a frame; the new area replaces the old once it is all built. */
  update(px: number, pz: number, deadline: number): void {
    const h = this.heights();
    if (!this.enabled || !h) { this.clear(); return; }
    const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
    if (!this.block || this.block.cx !== cx || this.block.cz !== cz) {
      this.block = { cx, cz };
      for (const m of this.pending.values()) m.geometry.dispose();
      this.pending = new Map();
      this.queue = [];
      for (let dz = -RING; dz <= RING; dz++) for (let dx = -RING; dx <= RING; dx++) this.queue.push([cx + dx, cz + dz]);
    }
    // (At least one chunk a frame while any wait, whatever the frame's budget.)
    let built = 0;
    while (this.queue.length && (built++ === 0 || performance.now() < deadline)) {
      const [x, z] = this.queue.shift()!, chunk = this.getChunk(x, z);
      if (!chunk || chunk.lod !== 0) { this.queue.push([x, z]); return; }
      const mesh = new Mesh(this.build(chunk, h), this.material);
      mesh.position.set(x * CHUNK_SIZE, 0, z * CHUNK_SIZE);
      mesh.receiveShadow = true; mesh.castShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.pending.set(chunkKey(x, z), mesh);
    }
    if (!this.queue.length && this.pending.size) {
      // The whole area is ready: swap it in.
      this.clear();
      for (const [k, m] of this.pending) { this.meshes.set(k, m); this.scene.add(m); }
      this.pending = new Map();
      this.shown = { ...this.block };
      const x0 = (this.block.cx - RING) * CHUNK_SIZE, z0 = (this.block.cz - RING) * CHUNK_SIZE, size = (2 * RING + 1) * CHUNK_SIZE;
      reliefUniforms.uReliefRect.value = [x0, z0, x0 + size, z0 + size];
    }
  }

  private clear(): void {
    for (const m of this.meshes.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    this.shown = null;
    reliefUniforms.uReliefRect.value = [0, 0, -1, -1];
  }

  dispose(): void { this.clear(); for (const m of this.pending.values()) m.geometry.dispose(); this.pending.clear(); }

  /** Height of the plain terrain anywhere (the neighbour chunk at the edges). */
  private ground(x: number, z: number, own: ChunkData): number {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = cx === own.cx && cz === own.cz ? own : this.getChunk(cx, cz) ?? own;
    return chunkHeightAtLocal(c, Math.min(CHUNK_SIZE, Math.max(0, x - c.cx * CHUNK_SIZE)), Math.min(CHUNK_SIZE, Math.max(0, z - c.cz * CHUNK_SIZE)));
  }

  private build(chunk: ChunkData, maps: ReliefHeights): BufferGeometry {
    // The plain chunk's own attributes (colour, layer weights, climate) at its metre grid.
    const base = buildTerrainGeometry(chunk, this.seaLevel, this.cosmeticSeed);
    const n = chunk.verts, k = this.density, M = (n - 1) * k + 1, step = CHUNK_SIZE / (n - 1) / k;
    const src = Object.fromEntries(ATTRS.map((a) => [a, base.getAttribute(a) as BufferAttribute])) as Record<typeof ATTRS[number], BufferAttribute>;
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const rect = this.block!, x0 = (rect.cx - RING) * CHUNK_SIZE, z0 = (rect.cz - RING) * CHUNK_SIZE, x1 = x0 + (2 * RING + 1) * CHUNK_SIZE, z1 = z0 + (2 * RING + 1) * CHUNK_SIZE;
    const W = new Float32Array(GROUND_LAYER_COUNT);
    // Interpolates the plain mesh's attributes on its own triangles (the same diagonal).
    const weights = (gi: number, gj: number) => {
      const i = Math.min(n - 2, Math.floor(gi / k)), j = Math.min(n - 2, Math.floor(gj / k));
      const fx = gi / k - i, fz = gj / k - j, a = j * n + i;
      return fx >= fz ? [a, a + 1, a + n + 1, 1 - fx, fx - fz, fz] as const : [a, a + n, a + n + 1, 1 - fz, fz - fx, fx] as const;
    };
    const S = maps.size, D = maps.data, mask = S - 1;
    const sample = (layer: number, u: number, v: number) => {
      const fu = (u - Math.floor(u)) * S - .5, fv = (v - Math.floor(v)) * S - .5;
      const iu = Math.floor(fu), iv = Math.floor(fv), tu = fu - iu, tv = fv - iv, b0 = layer * S * S;
      const x0 = iu & mask, x1 = (iu + 1) & mask, y0 = (iv & mask) * S, y1 = ((iv + 1) & mask) * S;
      return ((D[(b0 + y0 + x0) * 4]! * (1 - tu) + D[(b0 + y0 + x1) * 4]! * tu) * (1 - tv) + (D[(b0 + y1 + x0) * 4]! * (1 - tu) + D[(b0 + y1 + x1) * 4]! * tu) * tv) / 255;
    };
    // Relief at a point: the layers' height maps, as the shader projects them (top, or from the
    // side on steep ground), weighted by the layers and their own depth.
    const relief = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      const side = ny < .55 ? 1 : ny > .8 ? 0 : (.8 - ny) / .25;
      let d = 0;
      for (let l = 0; l < GROUND_LAYER_COUNT; l++) {
        const w = W[l]!, amp = GROUND_RELIEF[l]!;
        if (w < .04 || amp <= 0) continue;
        const t = GROUND_TILES[l]!;
        const u = side > .5 ? (Math.abs(nx) > Math.abs(nz) ? z : x) / t : x / t, v = side > .5 ? y / t : z / t;
        d += w * (sample(l, u, v) - .5) * amp;
      }
      // Eased to nothing at the area's edge (the plain terrain goes on from there).
      const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z) / EDGE;
      return d * Math.max(0, Math.min(1, edge));
    };
    // Displaced points, with a one-step border ring so the normals are seamless between chunks.
    const R = M + 2, P = new Float32Array(R * R * 3);
    // Raw arrays (attribute accessors are too slow for some 70 000 points a chunk).
    const layerArrays = [src.groundA.array, src.groundB.array, src.groundC.array] as ArrayLike<number>[], baseNormal = (base.getAttribute('normal') as BufferAttribute).array as ArrayLike<number>;
    const layerOf = (a: readonly [number, number, number, number, number, number]) => {
      for (let l = 0; l < GROUND_LAYER_COUNT; l++) {
        const arr = layerArrays[l >> 2]!, c = l & 3;
        W[l] = arr[a[0] * 4 + c]! * a[3] + arr[a[1] * 4 + c]! * a[4] + arr[a[2] * 4 + c]! * a[5];
      }
      let sum = 0; for (let l = 0; l < GROUND_LAYER_COUNT; l++) sum += W[l]!;
      if (sum > 0) for (let l = 0; l < GROUND_LAYER_COUNT; l++) W[l]! /= sum;
    };
    for (let rj = 0; rj < R; rj++) for (let ri = 0; ri < R; ri++) {
      const gi = Math.min(M - 1, Math.max(0, ri - 1)), gj = Math.min(M - 1, Math.max(0, rj - 1));
      const x = ox + (ri - 1) * step, z = oz + (rj - 1) * step, y = this.ground(x, z, chunk);
      // The plain normal (the chunk mesh's own, interpolated).
      const wt = weights(gi, gj), bn = baseNormal, i0 = wt[0] * 3, i1 = wt[1] * 3, i2 = wt[2] * 3;
      const nx = bn[i0]! * wt[3] + bn[i1]! * wt[4] + bn[i2]! * wt[5];
      const ny = bn[i0 + 1]! * wt[3] + bn[i1 + 1]! * wt[4] + bn[i2 + 1]! * wt[5];
      const nz = bn[i0 + 2]! * wt[3] + bn[i1 + 2]! * wt[4] + bn[i2 + 2]! * wt[5];
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      layerOf(wt);
      const d = relief(x, y, z, nx * inv, ny * inv, nz * inv), o = (rj * R + ri) * 3;
      P[o] = x - ox + nx * inv * d; P[o + 1] = y + ny * inv * d; P[o + 2] = z - oz + nz * inv * d;
    }
    const count = M * M, pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), flag = new Float32Array(count).fill(1);
    const out = Object.fromEntries(ATTRS.map((a) => [a, new Float32Array(count * src[a].itemSize)])) as Record<typeof ATTRS[number], Float32Array>;
    const attrList = ATTRS.map((name) => { const s = src[name]; return { arr: s.array as ArrayLike<number>, out: out[name], size: s.itemSize, sc: s.normalized ? 1 / 255 : 1 }; });
    for (let gj = 0; gj < M; gj++) for (let gi = 0; gi < M; gi++) {
      const v = gj * M + gi, r = ((gj + 1) * R + gi + 1) * 3;
      pos[v * 3] = P[r]!; pos[v * 3 + 1] = P[r + 1]!; pos[v * 3 + 2] = P[r + 2]!;
      // Normal from the displaced neighbours.
      const l = r - 3, rr = r + 3, u = r - R * 3, d = r + R * 3;
      const ax = P[rr]! - P[l]!, ay = P[rr + 1]! - P[l + 1]!, az = P[rr + 2]! - P[l + 2]!;
      const bx = P[d]! - P[u]!, by = P[d + 1]! - P[u + 1]!, bz = P[d + 2]! - P[u + 2]!;
      let cx = bz * ay - by * az, cy = bx * az - bz * ax, cz = by * ax - bx * ay;
      if (cy < 0) { cx = -cx; cy = -cy; cz = -cz; }
      const il = 1 / (Math.hypot(cx, cy, cz) || 1);
      nrm[v * 3] = cx * il; nrm[v * 3 + 1] = cy * il; nrm[v * 3 + 2] = cz * il;
      const [a, b, c, wa, wb, wc] = weights(gi, gj);
      // (Layer weights and climate are bytes read as 0…1 by the shader.)
      for (const { arr, out: o2, size, sc } of attrList) {
        for (let q = 0; q < size; q++) o2[v * size + q] = (arr[a * size + q]! * wa + arr[b * size + q]! * wb + arr[c * size + q]! * wc) * sc;
      }
    }
    const index = new Uint32Array((M - 1) * (M - 1) * 6);
    let o = 0;
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; terrainCellIndices(a, a + 1, a + M, a + M + 1, index, o); o += 6; }
    base.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    for (const name of ATTRS) g.setAttribute(name, new BufferAttribute(out[name], src[name].itemSize));
    g.setAttribute('aRelief', new BufferAttribute(flag, 1));
    g.setIndex(new BufferAttribute(index, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
