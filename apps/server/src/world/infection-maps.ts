import { DEFAULT_INFECTION_MAPS, INFECTION_MAP, upgradeInfectionMaps, Surface, hashString, infectionMapSchema, infectionMapsSchema, type InfectionMapDef, type InfectionMaps } from '@zion/shared';
import type { AssetRegistry } from '@zion/assets';
import { GENERATOR_VERSION, WorldGenerator, friday13Structures, WAREHOUSE, infectionHeight, infectionLayers, infectionSpawns, infectionSurface, infectionZombieSpawns, normalizeSeed } from '@zion/worldgen';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import { WorldService } from './world-service';
import { atlasProvider, atlasTileProvider } from './atlas';

interface Built { def: InfectionMapDef; key: string; worldId: string; world: WorldService; atlas: ReturnType<typeof atlasProvider>; tiles: ReturnType<typeof atlasTileProvider> }

export interface InfectionMapPreview {
  half: number; step: number; size: number; origin: number;
  heights: number[]; grass: number[];
  base: Array<{ asset: number; x: number; z: number; yaw: number; scale: number }>;
  wall: Array<{ asset: number; x: number; z: number; yaw: number; scale: number }>;
  nature: Array<{ asset: number; x: number; z: number; yaw: number; scale: number }>;
  spawns: Array<{ x: number; z: number }>;
  zombieSpawns: Array<{ x: number; z: number }>;
}

const configOf = (def: InfectionMapDef) => ({ seed: normalizeSeed(def.seed), sizeChunks: INFECTION_MAP.sizeChunks, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'infection' as const, infection: def });

/**
 * Infection maps from the Studio: stored in server_settings, the active one built into a live
 * world that new matches are played on. Matches already running keep the world they started on;
 * worlds nothing plays on any more are closed.
 */
export class InfectionMapService {
  maps: InfectionMaps = structuredClone(DEFAULT_INFECTION_MAPS);
  private current!: Built;
  private readonly built = new Map<string, Built>();
  /** Called after the active map changed (spare lobbies on the old map are replaced). */
  onSwitch: (() => void) | null = null;

  constructor(private readonly db: Db, private readonly registry: AssetRegistry, private readonly cacheSize: number, private readonly log: Logger, private readonly workers = 1) {}

  async load(): Promise<void> {
    try {
      const row = (await this.db.query<{ value: unknown }>(`SELECT value FROM server_settings WHERE key = 'infection_maps'`)).rows[0];
      const parsed = row ? infectionMapsSchema.safeParse(row.value) : null;
      if (parsed?.success) this.maps = upgradeInfectionMaps(parsed.data);
      else if (parsed) this.log.warn({ issues: parsed.error.issues.slice(0, 3) }, 'stored infection maps invalid; using the built-in map');
    } catch (err) {
      this.log.error({ err }, 'failed to load infection maps (using the built-in map)');
    }
    // Same key order as every later save, so an unchanged map never rebuilds its world.
    this.maps = infectionMapsSchema.parse(this.maps);
    this.current = await this.build(this.active);
  }

  get active(): InfectionMapDef { return this.maps.maps.find((m) => m.id === this.maps.active)!; }
  get world(): WorldService { return this.current.world; }
  get worldId(): string { return this.current.worldId; }
  atlas() { return this.current.atlas(); }
  tile(x: number, z: number) { return this.current.tiles(x, z); }

  private async build(def: InfectionMapDef): Promise<Built> {
    const key = JSON.stringify(def), have = this.built.get(key);
    if (have) return have;
    const world = new WorldService(configOf(def), this.registry, this.workers, this.cacheSize, this.log);
    await world.start();
    // Distinct per version of a map, so clients never reuse map tiles of an older version.
    const worldId = `${INFECTION_MAP.id}-${def.id}-${(hashString(key) >>> 0).toString(36)}`;
    const built: Built = { def, key, worldId, world, atlas: atlasProvider(world.generator, worldId), tiles: atlasTileProvider(world.generator, worldId) };
    this.built.set(key, built);
    return built;
  }

  private async persist(): Promise<void> {
    await this.db.query(`INSERT INTO server_settings (key, value) VALUES ('infection_maps', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(this.maps)]);
  }

  private async refresh(): Promise<void> {
    const next = await this.build(this.active);
    if (next === this.current) return;
    this.current = next;
    this.onSwitch?.();
  }

  async save(input: unknown): Promise<InfectionMaps> {
    const def = infectionMapSchema.parse(input);
    const maps = this.maps.maps.some((m) => m.id === def.id) ? this.maps.maps.map((m) => (m.id === def.id ? def : m)) : [...this.maps.maps, def];
    this.maps = infectionMapsSchema.parse({ ...this.maps, maps });
    await this.persist();
    await this.refresh();
    return this.maps;
  }

  async remove(id: string): Promise<InfectionMaps> {
    if (id === this.maps.active) throw new Error('Không xóa được bản đồ đang dùng.');
    this.maps = infectionMapsSchema.parse({ ...this.maps, maps: this.maps.maps.filter((m) => m.id !== id) });
    await this.persist();
    return this.maps;
  }

  async activate(id: string): Promise<InfectionMaps> {
    this.maps = infectionMapsSchema.parse({ ...this.maps, active: id });
    await this.persist();
    await this.refresh();
    return this.maps;
  }

  /** Closes the worlds of old map versions that no match plays on any more. */
  async sweep(inUse: ReadonlySet<WorldService>): Promise<void> {
    for (const [key, b] of this.built) {
      if (b === this.current || inUse.has(b.world)) continue;
      this.built.delete(key);
      await b.world.close().catch((err: unknown) => this.log.error({ err }, 'infection world close failed'));
    }
  }

  async close(): Promise<void> {
    for (const b of this.built.values()) await b.world.close();
    this.built.clear();
  }

  /** The ground, grass, wall, nature and spawn points of a map as the server would build it. */
  preview(input: unknown): InfectionMapPreview {
    const def = infectionMapSchema.parse(input);
    const gen = new WorldGenerator(configOf(def), this.registry);
    const c = gen.worldSize / 2, ext = def.half + 30, step = Math.max(1, Math.ceil(ext * 2 / 200)), size = Math.floor(ext * 2 / step) + 1;
    const heights: number[] = [], grass: number[] = [];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = c - ext + i * step, z = c - ext + j * step;
      heights.push(Math.round(infectionHeight(gen, x, z) * 10) / 10);
      grass.push(infectionSurface(gen, x, z, 0) === Surface.Grass ? 1 : 0);
    }
    const rel = (list: Array<{ asset: number; x: number; z: number; yaw: number; scale: number }>) => list.map((p) => ({ asset: p.asset, x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), scale: p.scale }));
    const base = def.base === 'friday13' ? friday13Structures(gen).flatMap((s) => s.parts.map((p) => ({ ...p, x: s.x - c + p.x, z: s.z - c + p.z })))
      : def.base === 'warehouse' ? [{ asset: WAREHOUSE.asset, x: 0, z: 0, yaw: 0, scale: 1 }] : [];
    const layers = infectionLayers(gen);
    const toRel = (list: Array<{ x: number; z: number }>) => list.map((s) => ({ x: +(s.x - c).toFixed(2), z: +(s.z - c).toFixed(2) }));
    return { half: def.half, step, size, origin: -ext, heights, grass, base: rel(base), wall: rel(layers.wall), nature: rel(layers.nature), spawns: toRel(infectionSpawns(gen)), zombieSpawns: toRel(infectionZombieSpawns(gen)) };
  }
}
