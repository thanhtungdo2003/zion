import { randomInt } from 'node:crypto';
import { worldToChunk } from '@zion/shared';
import { DEFAULT_CHARACTER, Layer, Mask, makeRayHit, type CharacterController, type CollisionWorld } from '@zion/physics';
import type { SpawnPoint, WorldGenerator } from '@zion/worldgen';
import type { PhysicsChunkManager } from './physics-manager';

export interface ValidatedPosition {
  x: number;
  y: number;
  z: number;
}

/** Spiral offsets (metres) searched around a candidate when it is blocked by a prop. */
const NUDGES: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [[0, 0]];
  for (let r = 1; r <= 12; r++) {
    const steps = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return out;
})();

/**
 * Chooses and validates spawn positions against the authoritative collision world: on loaded LOD-0
 * terrain, inside world bounds, not in water deeper than wading, on walkable slope, and with the
 * character capsule free of any solid overlap.
 */
export class SpawnService {
  private readonly candidates: SpawnPoint[];
  private readonly shadeHit = makeRayHit();

  loadedZombieChunks(): Array<readonly [number, number]> { return this.physics.loadedChunks(); }

  /** Shelter and canopy block daylight; night makes open ground viable too. */
  zombieDarkness(x: number, y: number, z: number, night: boolean): number {
    const shaded = this.collision.raycast(x, y + 1.7, z, 0, 1, 0, 14, Mask.Camera, this.shadeHit);
    return night ? 1 : shaded ? 0.8 : 0.12;
  }

  constructor(
    private readonly gen: WorldGenerator,
    private readonly collision: CollisionWorld,
    private readonly controller: CharacterController,
    private readonly physics: PhysicsChunkManager,
  ) {
    this.candidates = gen.findSpawnPoints(gen.config.mode === 'battle-royale' ? 96 : 64, gen.config.mode === 'battle-royale' ? 65 : 180);
    if (this.candidates.length === 0) throw new Error('world has no valid spawn candidates');
  }

  /** Reserve the spawn compound and its approach from all zombie spawn candidates. */
  allowsZombieSpawn(x: number, z: number): boolean {
    const camp = this.gen.camp;
    return !camp || Math.max(Math.abs(x - camp.x), Math.abs(z - camp.z)) > 62;
  }

  /** Inside the camp wire: players can't hurt each other there. */
  inSafeZone(x: number, z: number): boolean {
    const camp = this.gen.camp;
    return !!camp && Math.max(Math.abs(x - camp.x), Math.abs(z - camp.z)) <= 50;
  }

  get candidateCount(): number {
    return this.candidates.length;
  }

  /**
   * Validates (and if needed nudges) a position; requires its chunks to be loaded. With
   * `requireOpen`, also demands a few metres of clearance from trunks, canopies and bushes so fresh
   * spawns get an unobstructed view.
   */
  validateAt(x: number, z: number, requireOpen = false): ValidatedPosition | null {
    const p = DEFAULT_CHARACTER;
    for (const [dx, dz] of NUDGES) {
      const px = x + dx;
      const pz = z + dz;
      if (px < p.boundsMargin + 1 || pz < p.boundsMargin + 1) continue;
      if (px > this.gen.worldSize - p.boundsMargin - 1 || pz > this.gen.worldSize - p.boundsMargin - 1) continue;
      if (!this.controller.canSimulateAt(px, pz)) continue;
      const ground = this.collision.terrainHeight(px, pz);
      if (ground !== ground) continue;
      if (this.collision.waterLevel(px, pz) - ground > p.wadeDepth) continue;
      const n = { x: 0, y: 1, z: 0 };
      this.collision.terrainNormal(px, pz, n);
      if (n.y < p.walkableNormalY) continue;
      const y = ground + 0.02;
      if (!this.controller.isFree(px, y, pz)) continue;
      if (requireOpen && this.collision.overlapsCapsule(px, y + 1.5, pz, px, y + 5, pz, 2.5, Layer.Static | Layer.Vegetation)) continue;
      return { x: px, y, z: pz };
    }
    return null;
  }

  /** Loads the area around (x, z) and validates a position there. */
  async validateLoaded(x: number, z: number, requireOpen = false): Promise<ValidatedPosition | null> {
    await this.physics.ensureArea(worldToChunk(x), worldToChunk(z), 1);
    return this.validateAt(x, z, requireOpen);
  }

  /** Picks a random candidate spawn and validates it, trying others if blocked. */
  async pickSpawn(): Promise<ValidatedPosition> {
    if (this.gen.camp) {
      const c = this.gen.camp;
      // Everyone spawns in the camp: a random spot along the central avenue so players don't stack.
      for (let i = 0; i < 6; i++) {
        const pos = await this.validateLoaded(c.x - 3 + Math.random() * 6, c.z - 15 + Math.random() * 42, true);
        if (pos) return pos;
      }
      const pos = await this.validateLoaded(c.x, c.z + 23, true);
      if (pos) return pos;
    }
    const start = randomInt(this.candidates.length);
    for (let i = 0; i < Math.min(8, this.candidates.length); i++) {
      const c = this.candidates[(start + i) % this.candidates.length]!;
      const pos = (await this.validateLoaded(c.x, c.z, true)) ?? this.validateAt(c.x, c.z);
      if (pos) return pos;
    }
    throw new Error('no valid spawn position found');
  }
}
