import { z } from 'zod';
import type { AssetDefinitionInput, AssetRegistry } from '@zion/assets';
import { BATTLE_MAP } from '@zion/shared';
import { GENERATOR_VERSION, authoredMapSchema, normalizeSeed, type AuthoredMap } from '@zion/worldgen';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import { MatchPool } from '../game/match-pool';
import type { GameServer } from '../game/game-server';
import { WorldService } from './world-service';
import { atlasProvider, atlasTileProvider } from './atlas';

/**
 * Battle royale maps published from the World Studio. Each one gets its own world (built from the
 * map's height grid, buildings, props and vegetation) and its own match pool next to the built-in
 * island; players pick one in the mode menu. Stored in `battle_maps`.
 */

export const DEFAULT_BATTLE_MAP_ID = 'hac-son';
const MAP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const publishSchema = z.object({
  id: z.string().regex(MAP_ID),
  name: z.string().min(1).max(80),
  /** Small preview image for the map picker (data URL). */
  thumbnail: z.string().max(400_000).regex(/^data:image\//).optional(),
  seaLevel: z.number().min(0).max(200).default(20),
  map: z.unknown(),
}).strict();
export type PublishInput = z.infer<typeof publishSchema>;

interface Entry { id: string; name: string; thumbnail: string | null; updatedAt: string; world: WorldService; pool: MatchPool; worldId: string; atlas: ReturnType<typeof atlasProvider>; tiles: ReturnType<typeof atlasTileProvider> }

export class BattleMapService {
  private readonly maps = new Map<string, Entry>();

  constructor(
    private readonly db: Db,
    private readonly registry: AssetRegistry,
    private readonly cacheSize: number,
    private readonly log: Logger,
    private readonly createMatch: (world: WorldService, worldId: string) => GameServer,
    /** Runtime-registered models a map may place (Model Studio): its workers and players get them. */
    private readonly extraAssets: () => AssetDefinitionInput[] = () => [],
  ) {}

  /** The runtime models a map places (its parts or their composites). */
  private usedAssets(map: AuthoredMap): AssetDefinitionInput[] {
    const ids = new Set<number>();
    for (const p of map.placed ?? []) for (const q of p.parts) ids.add(q.asset);
    return this.extraAssets().filter((d) => ids.has(d.numericId));
  }

  async load(): Promise<void> {
    try {
      const rows = (await this.db.query<{ id: string; name: string; thumbnail: string | null; sea_level: number; map: unknown; updated_at: Date }>('SELECT id, name, thumbnail, sea_level, map, updated_at FROM battle_maps ORDER BY updated_at')).rows;
      for (const r of rows) {
        try { await this.build(r.id, r.name, r.thumbnail, r.sea_level, authoredMapSchema.parse(r.map) as AuthoredMap, r.updated_at.toISOString()); }
        catch (err) { this.log.error({ err, id: r.id }, 'battle map could not be built (skipped)'); }
      }
    } catch (err) {
      this.log.error({ err }, 'failed to load battle maps (only the built-in island is offered)');
    }
  }

  private async build(id: string, name: string, thumbnail: string | null, seaLevel: number, map: AuthoredMap, updatedAt: string): Promise<Entry> {
    const size = map.terrainGrid?.size ?? BATTLE_MAP.sizeChunks * 32;
    const world = new WorldService({ seed: normalizeSeed(`br-${id}`), sizeChunks: Math.round(size / 32), seaLevel, generatorVersion: GENERATOR_VERSION, mode: 'battle-royale', battleIsland: map as never }, this.registry, 1, this.cacheSize, this.log, this.usedAssets(map));
    await world.start();
    const worldId = `br-${id}-${updatedAt.replace(/\D/g, '').slice(0, 14)}`;
    const pool = new MatchPool(() => this.createMatch(world, worldId), this.log.child({ module: `battle-map-${id}` }), 6);
    pool.start();
    const entry: Entry = { id, name, thumbnail, updatedAt, world, pool, worldId, atlas: atlasProvider(world.generator, worldId), tiles: atlasTileProvider(world.generator, worldId) };
    const old = this.maps.get(id);
    this.maps.set(id, entry);
    // A republished map: new matches use the new world; the old one closes when its matches end.
    if (old) void old.pool.stop().then(() => old.world.close()).catch((err: unknown) => this.log.error({ err }, 'old battle map close failed'));
    return entry;
  }

  async publish(input: unknown): Promise<{ id: string; name: string }> {
    const body = publishSchema.parse(input);
    if (body.id === DEFAULT_BATTLE_MAP_ID) throw new Error('ID trùng bản đồ mặc định.');
    const map = authoredMapSchema.parse(body.map) as AuthoredMap;
    if (!map.terrainGrid) throw new Error('Bản đồ thiếu dữ liệu địa hình.');
    const updatedAt = new Date().toISOString();
    await this.db.query(`INSERT INTO battle_maps (id, name, thumbnail, sea_level, map, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, thumbnail = EXCLUDED.thumbnail, sea_level = EXCLUDED.sea_level, map = EXCLUDED.map, updated_at = EXCLUDED.updated_at`,
      [body.id, body.name, body.thumbnail ?? null, body.seaLevel, JSON.stringify(map), updatedAt]);
    await this.build(body.id, body.name, body.thumbnail ?? null, body.seaLevel, map, updatedAt);
    this.log.info({ id: body.id, sites: map.placed?.length ?? 0, flora: map.flora?.length ?? 0 }, 'battle map published');
    return { id: body.id, name: body.name };
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM battle_maps WHERE id = $1', [id]);
    const e = this.maps.get(id);
    this.maps.delete(id);
    if (e) await e.pool.stop().then(() => e.world.close()).catch(() => {});
  }

  pool(id: string): MatchPool | undefined { return this.maps.get(id)?.pool; }
  entry(id: string): Entry | undefined { return this.maps.get(id); }

  /** For the map picker: every published map with how many people are playing on it now. */
  list(): Array<{ id: string; name: string; thumbnail: string | null; players: number; matches: number; updatedAt: string }> {
    return [...this.maps.values()].map((e) => ({ id: e.id, name: e.name, thumbnail: e.thumbnail, updatedAt: e.updatedAt, matches: e.pool.matches.length, players: e.pool.matches.reduce((n, m) => n + m.playerCount, 0) }));
  }

  async close(): Promise<void> {
    for (const e of this.maps.values()) { await e.pool.stop().catch(() => {}); await e.world.close().catch(() => {}); }
    this.maps.clear();
  }
}
