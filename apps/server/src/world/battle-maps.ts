import { z } from 'zod';
import type { AssetDefinitionInput, AssetRegistry } from '@zion/assets';
import { BATTLE_MAP, WORLD_MAP_MODE_IDS, validateWarfareLayout, warfareLayoutSchema, worldMapModesSchema, type WarfareLayout, type WorldMapMode } from '@zion/shared';
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
  /** The editor document (without terrain) so the map can be opened again elsewhere. */
  source: z.record(z.unknown()).optional(),
  /** Warfare battlefield on this map (absent: the map is not offered for Warfare). */
  warfare: warfareLayoutSchema.optional(),
  /** Game modes it is offered in (default: battle royale, as maps published before). */
  modes: worldMapModesSchema.default(['battle-royale']),
}).strict();
export type PublishInput = z.infer<typeof publishSchema>;

interface Entry { id: string; name: string; thumbnail: string | null; updatedAt: string; warfare: WarfareLayout | null; modes: WorldMapMode[]; world: WorldService; pool: MatchPool | null; worldId: string; atlas: ReturnType<typeof atlasProvider>; tiles: ReturnType<typeof atlasTileProvider> }

export class BattleMapService {
  private readonly maps = new Map<string, Entry>();
  /** Maps stored but not playable (their world failed to build), with the reason. */
  private readonly failed = new Map<string, string>();

  /** Directory fixed maps' chunks are baked to (null: off). */
  bakeRoot: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly registry: AssetRegistry,
    private readonly cacheSize: number,
    private readonly log: Logger,
    private readonly createMatch: (world: WorldService, worldId: string) => GameServer,
    /** Runtime-registered models a map may place (Model Studio): its workers and players get them. */
    private readonly extraAssets: () => AssetDefinitionInput[] = () => [],
    /** Generator threads per map: battlefield matches with many bots ask a lot of one map. */
    private readonly workers = 1,
  ) {}

  /** The runtime models a map places (its parts or their composites). */
  private usedAssets(map: AuthoredMap): AssetDefinitionInput[] {
    const ids = new Set<number>();
    for (const p of map.placed ?? []) for (const q of p.parts) ids.add(q.asset);
    return this.extraAssets().filter((d) => ids.has(d.numericId));
  }

  async load(): Promise<void> {
    try {
      const rows = (await this.db.query<{ id: string; name: string; thumbnail: string | null; sea_level: number; map: unknown; updated_at: Date; warfare: unknown; modes: string[] | null }>('SELECT id, name, thumbnail, sea_level, map, updated_at, warfare, modes FROM battle_maps ORDER BY updated_at')).rows;
      for (const r of rows) {
        try { await this.build(r.id, r.name, r.thumbnail, r.sea_level, authoredMapSchema.parse(r.map) as AuthoredMap, r.updated_at.toISOString(), this.parseWarfare(r.warfare), this.parseModes(r.modes)); }
        catch (err) { this.failed.set(r.id, err instanceof Error ? err.message : String(err)); this.log.error({ err, id: r.id }, 'battle map could not be built (skipped)'); }
      }
    } catch (err) {
      this.log.error({ err }, 'failed to load battle maps (only the built-in island is offered)');
    }
  }

  /** Stored modes (unknown ones dropped; none left: battle royale, as before modes existed). */
  private parseModes(raw: string[] | null): WorldMapMode[] {
    const known = (raw ?? []).filter((m): m is WorldMapMode => (WORLD_MAP_MODE_IDS as readonly string[]).includes(m));
    return known.length ? known : ['battle-royale'];
  }

  /** Sets the modes a published map is offered in, without rebuilding it. */
  async setModes(id: string, input: unknown): Promise<{ id: string; modes: WorldMapMode[] }> {
    const e = this.maps.get(id);
    if (!e) throw new Error('Bản đồ chưa được xuất bản lên máy chủ.');
    const modes = worldMapModesSchema.parse(input);
    if (modes.includes('warfare')) {
      if (!e.warfare) throw new Error('Bản đồ chưa có bố cục Chiến trường — gán chiến trường ở tab Chiến trường.');
      const errs = this.checkWarfare(e.warfare, e.world.generator.worldSize);
      if (errs.length) throw new Error(`Bố cục Chiến trường chưa hợp lệ: ${errs.slice(0, 4).join('; ')}`);
    }
    await this.db.query('UPDATE battle_maps SET modes = $2 WHERE id = $1', [id, modes]);
    this.applyModes(e, modes);
    return { id, modes };
  }

  /** Battle royale matches only where the map is published for battle royale. */
  private applyModes(e: Entry, modes: WorldMapMode[]): void {
    e.modes = modes;
    if (modes.includes('battle-royale') && !e.pool) { e.pool = new MatchPool(() => this.createMatch(e.world, e.worldId), this.log.child({ module: `battle-map-${e.id}` }), 6); e.pool.start(); }
    if (!modes.includes('battle-royale') && e.pool) { const pool = e.pool; e.pool = null; void pool.stop().catch((err: unknown) => this.log.error({ err }, 'battle map pool stop failed')); }
  }

  /** A stored Warfare layout (an unreadable one is dropped, never fatal). */
  private parseWarfare(raw: unknown): WarfareLayout | null {
    if (!raw) return null;
    const r = warfareLayoutSchema.safeParse(raw);
    return r.success ? r.data : null;
  }

  /** Problems that keep a layout from being offered for Warfare on this map (empty = fine). */
  private checkWarfare(layout: WarfareLayout, size: number): string[] {
    const errs = layout.area ? [] : ['chưa chọn vùng chiến trường'];
    if (layout.area && (layout.area.x - layout.area.half < 0 || layout.area.z - layout.area.half < 0 || layout.area.x + layout.area.half > size || layout.area.z + layout.area.half > size)) errs.push('vùng chiến trường vượt ra ngoài bản đồ');
    return [...errs, ...validateWarfareLayout(layout)];
  }

  /**
   * Turns Warfare on / updates its layout / turns it off (null) for a published map, without
   * rebuilding the map's world: rooms opened afterwards use the new layout.
   */
  async setWarfare(id: string, input: unknown): Promise<{ id: string; warfare: WarfareLayout | null }> {
    const e = this.maps.get(id);
    if (!e) throw new Error('Bản đồ chưa được xuất bản lên máy chủ (hoặc chưa dựng xong) — hãy xuất bản trước.');
    const layout = input === null ? null : warfareLayoutSchema.parse(input);
    if (layout?.enabled) {
      const errs = this.checkWarfare(layout, e.world.generator.worldSize);
      if (errs.length) throw new Error(`Bố cục Chiến trường chưa hợp lệ: ${errs.slice(0, 4).join('; ')}`);
    }
    // Turning Warfare on (or off) for the map is offering it in that mode (or not); battle royale stays as chosen.
    const modes = layout?.enabled ? [...new Set<WorldMapMode>([...e.modes, 'warfare'])] : e.modes.filter((m) => m !== 'warfare');
    if (!modes.length) throw new Error('Bản đồ này chỉ dùng cho Chiến trường: muốn gỡ hẳn, hãy gỡ bản đồ khỏi game.');
    await this.db.query('UPDATE battle_maps SET warfare = $2::jsonb, modes = $3 WHERE id = $1', [id, layout ? JSON.stringify(layout) : null, modes]);
    e.warfare = layout;
    this.applyModes(e, modes);
    this.log.info({ id, warfare: !!layout?.enabled, zones: layout?.zones.length ?? 0 }, 'battle map warfare layout set');
    return { id, warfare: layout };
  }

  /** Published maps with Warfare turned on. */
  warfareMaps(): Array<{ id: string; name: string; thumbnail: string | null; world: WorldService; worldId: string; layout: WarfareLayout }> {
    return [...this.maps.values()].filter((e) => e.modes.includes('warfare') && e.warfare?.enabled).map((e) => ({ id: e.id, name: e.name, thumbnail: e.thumbnail, world: e.world, worldId: e.worldId, layout: e.warfare! }));
  }

  private async build(id: string, name: string, thumbnail: string | null, seaLevel: number, map: AuthoredMap, updatedAt: string, warfare: WarfareLayout | null = null, modes: WorldMapMode[] = ['battle-royale']): Promise<Entry> {
    const size = map.terrainGrid?.size ?? BATTLE_MAP.sizeChunks * 32;
    const world = new WorldService({ seed: normalizeSeed(`br-${id}`), sizeChunks: Math.round(size / 32), seaLevel, generatorVersion: GENERATOR_VERSION, mode: 'battle-royale', battleIsland: map as never }, this.registry, this.workers, this.cacheSize, this.log, this.usedAssets(map));
    await world.start();
    // A fixed map: chunks generated once, kept on disk, the rest baked in the background.
    if (this.bakeRoot) { world.bakeTo(this.bakeRoot); void world.bake(); }
    const worldId = `br-${id}-${updatedAt.replace(/\D/g, '').slice(0, 14)}`;
    const entry: Entry = { id, name, thumbnail, updatedAt, warfare, modes: [], world, pool: null, worldId, atlas: atlasProvider(world.generator, worldId), tiles: atlasTileProvider(world.generator, worldId) };
    this.applyModes(entry, modes);
    const old = this.maps.get(id);
    this.maps.set(id, entry);
    // A republished map: new matches use the new world; the old one closes when its matches end.
    if (old) void (old.pool?.stop() ?? Promise.resolve()).then(() => old.world.close()).catch((err: unknown) => this.log.error({ err }, 'old battle map close failed'));
    return entry;
  }

  async publish(input: unknown): Promise<{ id: string; name: string }> {
    const body = publishSchema.parse(input);
    if (body.id === DEFAULT_BATTLE_MAP_ID) throw new Error('ID trùng bản đồ mặc định.');
    const map = authoredMapSchema.parse(body.map) as AuthoredMap;
    if (!map.terrainGrid) throw new Error('Bản đồ thiếu dữ liệu địa hình.');
    const updatedAt = new Date().toISOString();
    const warfare = body.warfare ?? null, modes = body.modes;
    if (modes.includes('warfare') && !warfare?.enabled) throw new Error('Muốn xuất bản cho Chiến trường, hãy bật và vẽ bố cục ở tab Chiến trường.');
    if (warfare?.enabled && modes.includes('warfare')) {
      const errs = this.checkWarfare(warfare, map.terrainGrid.size);
      if (errs.length) throw new Error(`Bố cục Chiến trường chưa hợp lệ: ${errs.slice(0, 4).join('; ')}`);
    }
    // Built first: a map whose world cannot be made is refused instead of stored unplayable
    // (it would be listed nowhere in the game). The previous version keeps running meanwhile.
    await this.build(body.id, body.name, body.thumbnail ?? null, body.seaLevel, map, updatedAt, warfare, modes);
    await this.db.query(`INSERT INTO battle_maps (id, name, thumbnail, sea_level, map, updated_at, source, warfare, modes) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, thumbnail = EXCLUDED.thumbnail, sea_level = EXCLUDED.sea_level, map = EXCLUDED.map, updated_at = EXCLUDED.updated_at, source = EXCLUDED.source, warfare = EXCLUDED.warfare, modes = EXCLUDED.modes`,
      [body.id, body.name, body.thumbnail ?? null, body.seaLevel, JSON.stringify(map), updatedAt, body.source ? JSON.stringify(body.source) : null, warfare ? JSON.stringify(warfare) : null, modes]);
    this.failed.delete(body.id);
    this.log.info({ id: body.id, sites: map.placed?.length ?? 0, flora: map.flora?.length ?? 0 }, 'battle map published');
    return { id: body.id, name: body.name };
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM battle_maps WHERE id = $1', [id]);
    const e = this.maps.get(id);
    this.maps.delete(id);
    this.failed.delete(id);
    if (e) await (e.pool?.stop() ?? Promise.resolve()).then(() => e.world.close()).catch(() => {});
  }

  /** Battle royale matches on a map (only one published for battle royale). */
  pool(id: string): MatchPool | undefined { return this.maps.get(id)?.pool ?? undefined; }
  entry(id: string): Entry | undefined { return this.maps.get(id); }

  /** For the map picker: every published map with how many people are playing on it now. */
  list(): Array<{ id: string; name: string; thumbnail: string | null; players: number; matches: number; updatedAt: string }> {
    return [...this.maps.values()].filter((e) => e.pool).map((e) => ({ id: e.id, name: e.name, thumbnail: e.thumbnail, updatedAt: e.updatedAt, matches: e.pool!.matches.length, players: e.pool!.matches.reduce((n, m) => n + m.playerCount, 0) }));
  }

  /**
   * For the World Studio: every map stored on the server (straight from the table, so maps that
   * failed to build or were published from another machine are listed too), with its state.
   */
  async catalog(): Promise<Array<{ id: string; name: string; thumbnail: string | null; updatedAt: string; live: boolean; error?: string; players: number; matches: number; editable: boolean; bytes: number; warfare: boolean; modes: WorldMapMode[] }>> {
    const rows = (await this.db.query<{ id: string; name: string; thumbnail: string | null; updated_at: Date; editable: boolean; bytes: number }>(
      'SELECT id, name, thumbnail, updated_at, source IS NOT NULL AS editable, pg_column_size(map) AS bytes FROM battle_maps ORDER BY updated_at DESC')).rows;
    return rows.map((r) => {
      const e = this.maps.get(r.id), error = this.failed.get(r.id) ?? (e ? undefined : 'Chưa dựng được thế giới cho bản đồ này (xem log máy chủ); xuất bản lại để thử.');
      return { id: r.id, name: r.name, thumbnail: r.thumbnail, updatedAt: r.updated_at.toISOString(), live: !!e, ...(error ? { error } : {}), editable: r.editable, bytes: Number(r.bytes), warfare: !!e?.warfare?.enabled, modes: e?.modes ?? [],
        matches: e?.pool?.matches.length ?? 0, players: e?.pool?.matches.reduce((n, m) => n + m.playerCount, 0) ?? 0 };
    });
  }

  /** A stored map in full (for opening it in the World Studio). */
  async stored(id: string): Promise<{ id: string; name: string; seaLevel: number; map: unknown; source: unknown } | null> {
    const r = (await this.db.query<{ id: string; name: string; sea_level: number; map: unknown; source: unknown }>('SELECT id, name, sea_level, map, source FROM battle_maps WHERE id = $1', [id])).rows[0];
    return r ? { id: r.id, name: r.name, seaLevel: r.sea_level, map: r.map, source: r.source } : null;
  }

  async close(): Promise<void> {
    for (const e of this.maps.values()) { await e.pool?.stop().catch(() => {}); await e.world.close().catch(() => {}); }
    this.maps.clear();
  }
}
