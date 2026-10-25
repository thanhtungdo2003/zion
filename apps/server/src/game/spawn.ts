import { randomInt } from 'node:crypto';
import { worldToChunk } from '@zion/shared';
import { DEFAULT_CHARACTER, Layer, Mask, makeRayHit, type CharacterController, type CollisionWorld } from '@zion/physics';
import { INFECTION_GROUND, structuresNear, type SpawnPoint, type WorldGenerator } from '@zion/worldgen';
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
  /** `floor`: a floor height to stand on (spawn points placed in 3D), searched from just above it. */
  validateAt(x: number, z: number, requireOpen = false, floor?: number): ValidatedPosition | null {
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
      let y = ground + 0.02;
      // Infection maps built from one map model (the Warehouse) have their own floors above the
      // terrain: stand on the first surface below the map's ground level, never under it.
      if (this.gen.config.mode === 'infection') {
        const top = floor !== undefined ? floor + 1.5 : INFECTION_GROUND + 2.5;
        if (top > ground && this.collision.raycast(px, top, pz, 0, -1, 0, top - ground + .1, Mask.CharacterMovement, this.shadeHit) && this.shadeHit.ny >= p.walkableNormalY) y = top - this.shadeHit.t + 0.02;
      }
      if (!this.controller.isFree(px, y, pz)) continue;
      // Never inside a building's shell: not boxed in on every side, not in a slot between walls.
      // (A point placed on a floor in the Studio may well be indoors.)
      if (floor === undefined && this.trapped(px, y, pz)) continue;
      if (requireOpen && this.collision.overlapsCapsule(px, y + 1.5, pz, px, y + 5, pz, 2.5, Layer.Static | Layer.Vegetation)) continue;
      return { x: px, y, z: pz };
    }
    return null;
  }

  /**
   * Indoor spots of the buildings near (x, z) (world metres, approximate floor height): ground
   * floors, upper storeys and attics of abandoned houses and town blocks.
   */
  indoorSpots(x: number, z: number, radius: number): ValidatedPosition[] {
    if (this.gen.config.mode === 'battle-royale') return [];
    const out: ValidatedPosition[] = [];
    for (const s of structuresNear(this.gen, x, z, radius)) {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      for (const [px, py, pz] of s.spawns ?? []) {
        const wx = s.x + px * c + pz * sn, wz = s.z - px * sn + pz * c;
        if (Math.hypot(wx - x, wz - z) <= radius) out.push({ x: wx, y: s.y + py, z: wz });
      }
    }
    return out;
  }

  /**
   * Settles a spawn onto the floor under an indoor spot (within a metre or so of `y`), nudging
   * aside from crates and furniture; never onto a roof or into a wall.
   */
  validateIndoor(x: number, y: number, z: number): ValidatedPosition | null {
    for (const [dx, dz] of NUDGES.slice(0, 17)) {
      const px = x + dx * .8, pz = z + dz * .8;
      if (!this.controller.canSimulateAt(px, pz)) return null;
      if (!this.collision.raycast(px, y + 1.2, pz, 0, -1, 0, 2.6, Mask.CharacterMovement, this.shadeHit)) continue;
      const floor = y + 1.2 - this.shadeHit.t;
      if (this.shadeHit.ny < .7 || !this.controller.isFree(px, floor + .02, pz)) continue;
      // A ceiling overhead: the spot really is indoors.
      if (!this.collision.raycast(px, floor + 1.9, pz, 0, 1, 0, 6, Mask.LineOfSight, this.shadeHit)) continue;
      return { x: px, y: floor + .02, z: pz };
    }
    return null;
  }

  private readonly probe = makeRayHit();
  /**
   * A spot a character could not walk out of: walls within 4 m in every direction (a closed room
   * or the inside of a model), or a gap narrower than 1 m between two walls (the cavity between
   * a building's inner and outer faces).
   */
  trapped(x: number, y: number, z: number): boolean {
    const reach = 4, d: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      d.push(this.collision.raycast(x, y + 1, z, Math.cos(a), 0, Math.sin(a), reach, Mask.CharacterMovement, this.probe) ? this.probe.t : reach);
    }
    if (d.every((t) => t < reach)) return true;
    return this.inWallGap(x, y, z, d);
  }

  /** Squeezed into a gap under 1 m wide between two walls (inside a model's wall). */
  inWallGap(x: number, y: number, z: number, d?: number[]): boolean {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 4;
      const f = d ? d[i]! : this.collision.raycast(x, y + 1, z, Math.cos(a), 0, Math.sin(a), 1, Mask.CharacterMovement, this.probe) ? this.probe.t : 1;
      const b = d ? d[i + 4]! : this.collision.raycast(x, y + 1, z, -Math.cos(a), 0, -Math.sin(a), 1, Mask.CharacterMovement, this.probe) ? this.probe.t : 1;
      if (f + b < 1) return true;
    }
    return false;
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
