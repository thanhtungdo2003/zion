import { DEFAULT_INFECTION_MAPS, INFECTION_MAP, upgradeInfectionMaps, Surface, hashString, infectionMapSchema, infectionMapsSchema, type InfectionMapDef, type InfectionMaps } from '@zion/shared';
import { UPLOADED_MAP_ASSET_MAX, UPLOADED_MAP_ASSET_MIN, createDefaultRegistry, uploadedMapAsset, uploadedMapUrl, type AssetDefinitionInput, type AssetRegistry, type UploadedMapFit } from '@zion/assets';
import { GENERATOR_VERSION, WorldGenerator, friday13Structures, WAREHOUSE, INFECTION_GROUND, infectionHeight, infectionLayers, infectionSpawns, infectionSurface, infectionZombieSpawns, normalizeSeed } from '@zion/worldgen';
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
  spawns: Array<{ x: number; z: number; y?: number }>;
  zombieSpawns: Array<{ x: number; z: number; y?: number }>;
  /** The map's ground height (models and spawn heights are relative to the world). */
  ground: number;
}

const configOf = (def: InfectionMapDef) => ({ seed: normalizeSeed(def.seed), sizeChunks: INFECTION_MAP.sizeChunks, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'infection' as const, infection: def });

/**
 * Infection maps from the Studio: stored in server_settings, the active one built into a live
 * world that new matches are played on. Matches already running keep the world they started on;
 * worlds nothing plays on any more are closed.
 */
/** A map model uploaded in the Studio. */
export interface InfectionMapModel { asset: number; name: string; version: number; def: AssetDefinitionInput }

/** Largest map model accepted from the Studio. */
export const MAX_MAP_MODEL_BYTES = 48 * 1024 * 1024;

export class InfectionMapService {
  maps: InfectionMaps = structuredClone(DEFAULT_INFECTION_MAPS);
  /** Uploaded map models by asset id (their files are read from the database on demand). */
  readonly models = new Map<number, InfectionMapModel>();
  private current!: Built;
  private readonly built = new Map<string, Built>();
  /** Called after the active map changed (spare lobbies on the old map are replaced). */
  onSwitch: (() => void) | null = null;
  /** Called once a saved map's new world is built (its own lobbies are replaced). */
  onMapChanged: ((id: string) => void) | null = null;

  constructor(private readonly db: Db, private readonly registry: AssetRegistry, private readonly cacheSize: number, private readonly log: Logger, private readonly workers = 1) {}

  async load(): Promise<void> {
    try {
      const { rows } = await this.db.query<{ asset: number; name: string; def: AssetDefinitionInput; updated_at: Date }>('SELECT asset, name, def, updated_at FROM infection_map_models');
      for (const row of rows) this.addModel({ asset: row.asset, name: row.name, version: new Date(row.updated_at).getTime(), def: row.def });
    } catch (err) {
      this.log.error({ err }, 'failed to load uploaded infection map models');
    }
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
    // Every other map too: players pick any map in the menu.
    void this.buildAll();
  }

  private building: Promise<void> | null = null;
  /** Builds the world of every map not built yet (in the background, one at a time). */
  private buildAll(): Promise<void> {
    this.building ??= (async () => {
      for (const def of this.maps.maps) await this.build(def).catch((err: unknown) => this.log.error({ err, map: def.id }, 'infection map build failed'));
    })().finally(() => { this.building = null; });
    return this.building;
  }

  /** A map's world as built now (undefined while it is still being built). */
  builtFor(id: string): Built | undefined {
    const def = this.maps.maps.find((m) => m.id === id);
    return def ? this.built.get(JSON.stringify({ ...def, name: '', rules: null })) : undefined;
  }

  /** For the menu's map picker. */
  list(): Array<{ id: string; name: string; ready: boolean; active: boolean }> {
    return this.maps.maps.map((m) => ({ id: m.id, name: m.name, ready: !!this.builtFor(m.id), active: m.id === this.maps.active }));
  }

  get active(): InfectionMapDef { return this.maps.maps.find((m) => m.id === this.maps.active)!; }
  get world(): WorldService { return this.current.world; }
  get worldId(): string { return this.current.worldId; }
  atlas(map?: string | null) { return (map && this.builtFor(map) || this.current).atlas(); }
  tile(x: number, z: number, map?: string | null) { return (map && this.builtFor(map) || this.current).tiles(x, z); }

  private addModel(model: InfectionMapModel): void {
    try { this.registry.registerUploaded(model.def); this.models.set(model.asset, model); }
    catch (err) { this.log.warn({ err, asset: model.asset }, 'uploaded map model skipped (invalid)'); }
  }

  /** Map models for the Studio list (with their definitions, for its 3D view). */
  modelList(): Array<InfectionMapModel & { url: string }> {
    return [...this.models.values()].map((m) => ({ ...m, url: uploadedMapUrl(m.asset, m.version) }));
  }

  /** Stores an uploaded map model: its collision is computed here, once. */
  /** `fit`: centring and collision computed by the Studio (it decodes compressed models); else here. */
  async uploadModel(name: string, glb: Buffer, fit?: UploadedMapFit): Promise<InfectionMapModel & { url: string }> {
    if (glb.length > MAX_MAP_MODEL_BYTES) throw new Error('File model quá lớn (tối đa 48 MB).');
    let asset = UPLOADED_MAP_ASSET_MIN;
    while (this.models.has(asset)) if (++asset > UPLOADED_MAP_ASSET_MAX) throw new Error('Đã hết chỗ cho model bản đồ mới (tối đa 100).');
    const def = uploadedMapAsset(asset, name.slice(0, 60) || 'Bản đồ', new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength), fit);
    // Checked the way every server and client will register it.
    createDefaultRegistry().registerUploaded(def);
    const { rows } = await this.db.query<{ updated_at: Date }>('INSERT INTO infection_map_models (asset, name, glb, def) VALUES ($1, $2, $3, $4::jsonb) RETURNING updated_at', [asset, def.name, glb, JSON.stringify(def)]);
    const model = { asset, name: def.name, version: new Date(rows[0]!.updated_at).getTime(), def };
    this.addModel(model);
    return { ...model, url: uploadedMapUrl(asset, model.version) };
  }

  /** An uploaded map model's file. */
  async modelFile(asset: number): Promise<Buffer | null> {
    if (!this.models.has(asset)) return null;
    return (await this.db.query<{ glb: Buffer }>('SELECT glb FROM infection_map_models WHERE asset = $1', [asset])).rows[0]?.glb ?? null;
  }

  /** The uploaded assets a map's world needs (workers and clients register them too). */
  private extraAssets(def: InfectionMapDef): AssetDefinitionInput[] {
    const model = def.base === 'model' && def.model ? this.models.get(def.model.asset) : undefined;
    return model ? [model.def] : [];
  }

  /** Builds in progress by key: a map asked for twice at once (menu, activation) gets one world. */
  private readonly pending = new Map<string, Promise<Built>>();
  private build(def: InfectionMapDef): Promise<Built> {
    const key = JSON.stringify({ ...def, name: '', rules: null });
    const running = this.pending.get(key);
    if (running && !this.built.has(key)) return running;
    const p = this.buildNow(def).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async buildNow(def: InfectionMapDef): Promise<Built> {
    // Only what shapes the world needs a new one: rules (round timings, time of day…) and the
    // name are applied to the world already built, in place, without regenerating anything.
    const key = JSON.stringify({ ...def, name: '', rules: null }), have = this.built.get(key);
    if (have) {
      have.def = def;
      const live = have.world.generator.config.infection;
      if (live) { live.name = def.name; Object.assign(live.rules, def.rules); }
      return have;
    }
    const world = new WorldService(configOf(def), this.registry, this.workers, this.cacheSize, this.log, this.extraAssets(def));
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
    if (def.base === 'model' && (!def.model || !this.models.has(def.model.asset))) throw new Error('Chọn model bản đồ đã tải lên.');
    const maps = this.maps.maps.some((m) => m.id === def.id) ? this.maps.maps.map((m) => (m.id === def.id ? def : m)) : [...this.maps.maps, def];
    this.maps = infectionMapsSchema.parse({ ...this.maps, maps });
    await this.persist();
    // A changed layout is generated in the background: the save answers at once.
    void this.refresh().then(() => this.buildAll()).then(() => this.onMapChanged?.(def.id)).catch((err: unknown) => this.log.error({ err }, 'infection map rebuild failed'));
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
      // The current version of every map stays (any map can be picked).
      if (b === this.current || inUse.has(b.world) || this.maps.maps.some((m) => JSON.stringify({ ...m, name: '', rules: null }) === key)) continue;
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
    // Every model with its world height (y), for the Studio's 3D view of the whole map.
    const rel = (list: Array<{ asset: number; x: number; z: number; y?: number; yaw: number; scale: number }>, ground = true) => list.map((p) => ({
      asset: p.asset, x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), scale: p.scale,
      y: +((ground ? infectionHeight(gen, c + p.x, c + p.z) : 0) + (p.y ?? 0)).toFixed(2),
    }));
    const base = def.base === 'friday13' ? friday13Structures(gen).flatMap((s) => s.parts.map((p) => ({ ...p, x: s.x - c + p.x, z: s.z - c + p.z, y: s.y + p.y })))
      : def.base === 'warehouse' ? [{ asset: WAREHOUSE.asset, x: 0, z: 0, y: INFECTION_GROUND - WAREHOUSE.sink, yaw: 0, scale: 1 }]
      : def.base === 'model' && def.model ? [{ asset: def.model.asset, x: def.model.x ?? 0, z: def.model.z ?? 0, y: INFECTION_GROUND + def.model.y, yaw: def.model.yaw, scale: def.model.scale }] : [];
    const layers = infectionLayers(gen);
    const toRel = (list: Array<{ x: number; z: number; y?: number }>) => list.map((s) => ({ x: +(s.x - c).toFixed(2), z: +(s.z - c).toFixed(2), ...(s.y !== undefined ? { y: s.y } : {}) }));
    return { ground: INFECTION_GROUND, half: def.half, step, size, origin: -ext, heights, grass, base: rel(base, false), wall: rel(layers.wall), nature: rel(layers.nature), spawns: toRel(infectionSpawns(gen)), zombieSpawns: toRel(infectionZombieSpawns(gen)) };
  }
}
