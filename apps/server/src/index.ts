import { WaveRooms } from './game/wave-rooms';
import { WaveScoreRepository } from './repositories/wave-scores';
import type { LifeWorld } from './game/base-life';
import { BATTLE_MAP, SQUAD_LIMIT, STARTING_ZCOIN, WAVE_TEAM_LIMIT, validateContent } from '@zion/shared';
import { randomInt } from 'node:crypto';
import { createDefaultRegistry, type UploadedMapFit } from '@zion/assets';
import { GENERATOR_VERSION, normalizeSeed, type WorldConfig } from '@zion/worldgen';
import { loadConfig } from './config';
import { defaultMigrationsDir, migrate } from './db/migrate';
import { createPool } from './db/pool';
import { GameGateway } from './game/gateway';
import { MatchPool } from './game/match-pool';
import { InfectionMapService } from './world/infection-maps';
import { BattleMapService, DEFAULT_BATTLE_MAP_ID } from './world/battle-maps';
import { GameServer } from './game/game-server';
import { TeamService } from './game/teams';
import { CustomWeaponStore } from './repositories/custom-weapons';
import { GearFitStore } from './repositories/gear-fit';
import { HandStudioStore } from './repositories/hand-studio';
import { ProgressionService } from './game/progression';
import { atlasProvider, atlasTileProvider } from './world/atlas';
import { buildHttpApp } from './http/app';
import { CHARACTER_STYLES, type CharacterStyle } from './http/routes/studio';
import { VoiceHub } from './game/voice';
import type { HealthReport } from './http/routes/health';
import { createKeyValueStore } from './infra/kv';
import { createLogger } from './logger';
import { Metrics } from './metrics';
import { AccountRepository } from './repositories/accounts';
import { AuditLog } from './repositories/audit';
import { PlayerStateRepository } from './repositories/player-states';
import { RefreshTokenRepository } from './repositories/refresh-tokens';
import { WorldRepository } from './repositories/worlds';
import { CampLayoutRepository } from './repositories/camp-layouts';
import { NewsRepository } from './repositories/news';
import { CAMP_HALF_SIZE, NPC_STALLS, type CampNpcLayout } from '@zion/worldgen';
import { GUARD_POSTS } from './game/camp-guards';
import { AuthService } from './security/auth-service';
import { TokenService } from './security/tokens';
import { WorldService } from './world/world-service';
import { ModelStudioStore } from './model-studio/store';
import { ModelAgent } from './model-studio/agent';
import { AiSettings } from './model-studio/ai-settings';
import { TextureLibrary } from './model-studio/textures';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.LOG_PRETTY);

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception; exiting');
  process.exit(1);
});

async function main(): Promise<void> {
  const db = createPool({ url: config.DATABASE_URL, max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL, logger });
  await db.query('SELECT 1');
  if (config.DB_MIGRATE_ON_START) {
    const applied = await migrate(db, defaultMigrationsDir(), logger);
    logger.info({ applied }, 'database migrations up to date');
  }
  const kv = await createKeyValueStore(config.REDIS_URL, logger);
  const audit = new AuditLog(db, logger);
  const metrics = new Metrics();

  // The world record is the source of truth for the seed: once created, it never changes.
  const worlds = new WorldRepository(db);
  const requestedSeed = config.WORLD_SEED ? normalizeSeed(config.WORLD_SEED) : randomInt(0, 2 ** 32 - 1);
  const record = await worlds.findOrCreate({
    id: config.WORLD_ID,
    seed: requestedSeed,
    config: { sizeChunks: config.WORLD_SIZE_CHUNKS, seaLevel: 20 },
    generatorVersion: GENERATOR_VERSION,
    worldTimeMs: 0,
  });
  if (config.WORLD_SEED && record.seed !== requestedSeed) {
    logger.warn({ persisted: record.seed, requested: requestedSeed }, 'WORLD_SEED ignored: world already exists with another seed');
  }
  const worldConfig: WorldConfig = {
    seed: record.seed,
    sizeChunks: record.config.sizeChunks,
    seaLevel: record.config.seaLevel,
    generatorVersion: record.generatorVersion,
  };

  const registry = createDefaultRegistry();
  const world = new WorldService(worldConfig, registry, config.WORLDGEN_WORKERS, config.CHUNK_CACHE_SIZE, logger);
  await world.start();

  const tokens = new TokenService(config.JWT_SECRET, config.JWT_ISSUER, config.JWT_AUDIENCE, config.ACCESS_TOKEN_TTL_SEC);
  const refreshTokens = new RefreshTokenRepository(db);
  const accounts = new AccountRepository(db);
  const auth = new AuthService(accounts, refreshTokens, tokens, kv, audit, {
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
    allowGuest: config.ALLOW_GUEST,
  });

  const progression = new ProgressionService(db, config.WORLD_ID);
  await progression.initialize();
  const playerStates = new PlayerStateRepository(db, config.WORLD_ID, progression);
  // Studio weapons join the shared weapon/item/shop tables before any game server starts.
  const gearFit = new GearFitStore(db);
  await gearFit.load().catch((err: unknown) => logger.warn({ err }, 'gear fit not loaded'));
  const handStudio = new HandStudioStore(db);
  await handStudio.load().catch((err: unknown) => logger.warn({ err }, 'hand studio not loaded'));
  const customWeapons = new CustomWeaponStore(db);
  await customWeapons.load((id, err) => logger.warn({ id, err }, 'custom weapon skipped (invalid definition)'));
  const teams = new TeamService(await playerStates.loadTeams(), (id, team, player) => playerStates.saveTeam(id, team, player));
  const game = new GameServer({
    appearances: accounts,
    progression,
    teams,
    config,
    logger,
    metrics,
    audit,
    world,
    registry,
    playerStates,
    worlds,
    worldId: config.WORLD_ID,
    initialWorldTimeMs: record.worldTimeMs,
  });

  // Model Studio: published models join the registry (and their collision) before any world.
  const modelStudio = new ModelStudioStore(db, registry);
  await modelStudio.load((asset, err) => logger.warn({ asset, err }, 'model studio asset skipped (invalid)')).catch((err: unknown) => logger.warn({ err }, 'model studio not loaded'));
  // Trial of Model Studio houses on the built-in island (Studio setting; applied at start).
  const trialRow = await db.query<{ value: { assets?: number[] } }>(`SELECT value FROM server_settings WHERE key = 'model_studio_trial'`).catch(() => ({ rows: [] as Array<{ value: { assets?: number[] } }> }));
  const trialAssets = (trialRow.rows[0]?.value.assets ?? []).filter((a) => modelStudio.publishedModel(a)).slice(0, 16);
  const studioHouses = trialAssets.map((asset) => ({ asset, radius: (modelStudio.publishedModel(asset)!.def as { bounds: { radius: number } }).bounds.radius }));
  const battleWorldId = studioHouses.length ? `${BATTLE_MAP.id}-trial-${trialAssets.join('-')}` : BATTLE_MAP.id;
  if (studioHouses.length) logger.info({ assets: trialAssets }, 'battle royale island: Model Studio houses on trial');
  const battleWorld = new WorldService({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'battle-royale', ...(studioHouses.length ? { studioHouses } : {}) }, registry, Math.min(1, config.WORLDGEN_WORKERS), config.CHUNK_CACHE_SIZE, logger, modelStudio.definitions());
  await battleWorld.start();
  // Battle royale squads are separate from survival teams: three players, kept in memory.
  const battleTeams = new TeamService([], async () => {}, { limit: SQUAD_LIMIT, squad: true });
  // Battle royale and infection run many matches at once over one shared world each; every
  // "Play" is matched into a match still gathering players (see MatchPool).
  let vehicleJolt: boolean | null = null;
  const battlePool = new MatchPool(() => {
    const match = new GameServer({ appearances: accounts, teams: battleTeams, config, logger, metrics: new Metrics(), audit, world: battleWorld, registry, playerStates, worlds, worldId: battleWorldId, initialWorldTimeMs: 0, mode: 'battle-royale' });
    if (vehicleJolt !== null) match.vehicleJolt = vehicleJolt;
    return match;
  }, logger.child({ module: 'battle-matches' }));
  // Battle royale maps published from the World Studio: one world and match pool each.
  const battleMaps = new BattleMapService(db, registry, config.CHUNK_CACHE_SIZE, logger.child({ module: 'battle-maps' }), (mapWorld, mapWorldId) => {
    const match = new GameServer({ appearances: accounts, teams: battleTeams, config, logger, metrics: new Metrics(), audit, world: mapWorld, registry, playerStates, worlds, worldId: mapWorldId, initialWorldTimeMs: 0, mode: 'battle-royale' });
    if (vehicleJolt !== null) match.vehicleJolt = vehicleJolt;
    return match;
  }, () => modelStudio.definitions());
  await battleMaps.load();
  // Infection ("Lây Nhiễm"): the small walled night town, its own rooms of humans and bots.
  // Infection maps come from the Studio; new matches are built on the active one.
  const infectionMaps = new InfectionMapService(db, registry, config.CHUNK_CACHE_SIZE, logger.child({ module: 'infection-maps' }));
  await infectionMaps.load();
  const infectionPool = new MatchPool(() => new GameServer({ appearances: accounts, config, logger, metrics: new Metrics(), audit, world: infectionMaps.world, registry, playerStates, worlds, worldId: infectionMaps.worldId, initialWorldTimeMs: 0, mode: 'infection' }), logger.child({ module: 'infection-matches' }));
  infectionMaps.onSwitch = () => { void infectionPool.retireIdle(); };
  // A map picked in the menu (not the active one): its own pool of matches on its own world.
  const infectionPools = new Map<string, MatchPool>();
  const infectionPoolFor = (id: string): MatchPool | undefined => {
    if (id === infectionMaps.maps.active) return infectionPool;
    // Only published maps are played (drafts stay in the Studio).
    if (!infectionMaps.maps.maps.find((m) => m.id === id)?.published) return undefined;
    if (!infectionMaps.builtFor(id)) return undefined;
    let pool = infectionPools.get(id);
    if (!pool) {
      pool = new MatchPool(() => {
        const b = infectionMaps.builtFor(id) ?? { world: infectionMaps.world, worldId: infectionMaps.worldId };
        return new GameServer({ appearances: accounts, config, logger, metrics: new Metrics(), audit, world: b.world, registry, playerStates, worlds, worldId: b.worldId, initialWorldTimeMs: 0, mode: 'infection' });
      }, logger.child({ module: 'infection-matches', map: id }), 4);
      pool.start();
      infectionPools.set(id, pool);
    }
    return pool;
  };
  infectionMaps.onMapChanged = (id) => { void infectionPools.get(id)?.retireIdle(); };

  // Zombie Wave Survival: private rooms on the published Infection maps, parties of up to four,
  // results on eight boards per map.
  const waveTeams = new TeamService([], async () => {}, { limit: WAVE_TEAM_LIMIT });
  const waveScores = new WaveScoreRepository(db);
  const waveWorld = (id: string) => {
    if (!infectionMaps.maps.maps.find((m) => m.id === id)?.published) return undefined;
    return id === infectionMaps.maps.active ? { world: infectionMaps.world, worldId: infectionMaps.worldId } : infectionMaps.builtFor(id);
  };
  const waveMapList = () => infectionMaps.list().filter((m) => m.published && waveWorld(m.id));
  const waveRooms = new WaveRooms((cfg) => {
    const b = waveWorld(cfg.mapId);
    if (!b) return null;
    return new GameServer({ appearances: accounts, config, logger, metrics: new Metrics(), audit, world: b.world, registry, playerStates, worlds, worldId: b.worldId, initialWorldTimeMs: 0, mode: 'waves', waves: { ...cfg, record: (r) => waveScores.record(r) } });
  }, (accountId) => waveTeams.forAccount(accountId), (id) => waveMapList().find((m) => m.id === id) ?? null, logger.child({ module: 'wave-rooms' }));
  setInterval(() => {
    for (const [id, pool] of infectionPools) if (!infectionMaps.maps.maps.some((m) => m.id === id)) { void pool.stop(); infectionPools.delete(id); }
    void infectionMaps.sweep(new Set([infectionPool, ...infectionPools.values()].flatMap((p) => p.matches.map((m) => m.worldService))));
  }, 60_000).unref();
  const survivalAtlas = atlasProvider(world.generator, config.WORLD_ID, () => world.campLayout);
  const battleAtlas = atlasProvider(battleWorld.generator, battleWorldId);
  const survivalTiles = atlasTileProvider(world.generator, config.WORLD_ID);
  const battleTiles = atlasTileProvider(battleWorld.generator, battleWorldId);

  const savedLife = await db.query<{ state: LifeWorld }>('SELECT state FROM world_base_life WHERE world_id = $1', [config.WORLD_ID]);
  if (savedLife.rows[0]) game.lifeWorld = savedLife.rows[0].state;
  const savedContent = await db.query<{ content: unknown }>('SELECT content FROM game_content WHERE world_id = $1', [config.WORLD_ID]);
  if (savedContent.rows[0]) {
    const parsed = validateContent(savedContent.rows[0].content);
    if (!parsed.ok) throw new Error(`Invalid persisted game content: ${parsed.errors.join('; ')}`);
    game.applyContent(parsed.content);
  }

  // Studio switches persisted across restarts.
  let characterLook: CharacterStyle = 'survivor';
  try {
    const physics = await db.query<{ value: { jolt?: boolean } }>(`SELECT value FROM server_settings WHERE key = 'vehicle_physics'`);
    const jolt = physics.rows[0]?.value.jolt;
    if (typeof jolt === 'boolean') { game.vehicleJolt = jolt; vehicleJolt = jolt; }
    const style = await db.query<{ value: { style?: string; blocky?: boolean } }>(`SELECT value FROM server_settings WHERE key = 'character_style'`);
    const saved = style.rows[0]?.value;
    characterLook = CHARACTER_STYLES.find((s) => s === saved?.style) ?? (saved?.blocky === true ? 'blocky' : 'survivor');
  } catch (err) {
    logger.error({ err }, 'failed to load server settings (using defaults)');
  }

  let gateway: GameGateway | null = null;
  // Camp Studio: a saved camp layout replaces the generated one, live for everyone.
  const campLayouts = new CampLayoutRepository(db, config.WORLD_ID);
  let campUpdatedAt: string | null = null;
  let campNpcs: CampNpcLayout | null = null;
  let terrainCache: { size: number; step: number; origin: number; heights: number[]; water: number } | null = null;
  try {
    const saved = await campLayouts.load();
    if (saved) {
      game.applyCampLayout(saved.parts);
      game.applyCampNpcs(saved.npcs);
      campNpcs = saved.npcs;
      campUpdatedAt = saved.updatedAt;
      logger.info({ parts: saved.parts.length }, 'camp studio layout loaded');
    }
  } catch (err) {
    logger.error({ err }, 'failed to load camp studio layout (using default)');
  }

  // The agent's AI connection: set in the Studio (key stored encrypted) or from AI_* in the environment.
  const aiSettings = new AiSettings(db, config.JWT_SECRET, { ...(config.AI_API_KEY ? { apiKey: config.AI_API_KEY } : {}), baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, timeoutMs: config.AI_TIMEOUT_MS, retries: config.AI_MAX_RETRIES });
  await aiSettings.load().catch((err: unknown) => logger.warn({ err }, 'model studio AI settings not loaded'));
  const modelAgent = new ModelAgent(modelStudio, () => aiSettings.client(), () => registry.all().map((a) => ({ id: a.numericId, key: a.id, name: a.name, category: a.category, model: a.model.kind, tags: a.tags, radius: a.bounds.radius, height: a.bounds.height })), logger.child({ module: 'model-agent' }), 2000, () => aiSettings.fallbackModels());
  // Real texture sets: the Poly Haven library (CC0) and AI painting through the gateway.
  const textureLibrary = new TextureLibrary(modelStudio, aiSettings);
  modelAgent.textures = textureLibrary;
  logger.info({ ai: aiSettings.status().configured, source: aiSettings.status().source, model: aiSettings.status().model }, 'model studio agent ready');

  const app = await buildHttpApp({
    modelStudio: {
      store: modelStudio, agent: modelAgent, ai: aiSettings, textures: textureLibrary,
      trial: {
        get: () => ({ active: trialAssets, saved: trialAssets }),
        set: async (assets: number[]) => {
          await db.query(`INSERT INTO server_settings (key, value) VALUES ('model_studio_trial', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ assets })]);
          return { active: trialAssets, saved: assets, restartRequired: JSON.stringify(assets) !== JSON.stringify(trialAssets) };
        },
      },
    },
    appearances: accounts,
    news: new NewsRepository(db),
    customWeapons,
    gearFit,
    handStudio,
    progression,
    atlas: (mode, map) => mode === 'battle-royale' ? (map && battleMaps.entry(map)?.atlas() || battleAtlas()) : mode === 'infection' || mode === 'waves' ? infectionMaps.atlas(map) : survivalAtlas(),
    atlasTile: (x, z, mode, map) => mode === 'battle-royale' ? (map && battleMaps.entry(map)?.tiles(x, z) || battleTiles(x, z)) : mode === 'infection' || mode === 'waves' ? infectionMaps.tile(x, z, map) : survivalTiles(x, z),
    infectionModels: {
      list: () => infectionMaps.modelList(),
      upload: (name, glb, fit) => infectionMaps.uploadModel(name, glb, fit as UploadedMapFit | undefined),
      file: (asset) => infectionMaps.modelFile(asset),
    },
    infectionMapList: () => infectionMaps.list().filter((m) => m.published).map((m) => {
      const pool = m.active ? infectionPool : infectionPools.get(m.id);
      const matches = pool?.matches ?? [];
      return { ...m, players: matches.reduce((n, g) => n + g.playerCount, 0) };
    }),
    battleMaps: {
      list: () => [{ id: DEFAULT_BATTLE_MAP_ID, name: 'Đảo Hắc Sơn', thumbnail: null, builtin: true, players: battlePool.matches.reduce((n, m) => n + m.playerCount, 0), matches: battlePool.matches.length }, ...battleMaps.list()],
      publish: (input) => battleMaps.publish(input),
      remove: (id) => battleMaps.remove(id),
      catalog: () => battleMaps.catalog(),
      stored: (id) => battleMaps.stored(id),
    },
    teams,
    battleTeams,
    waveTeams,
    waves: {
      maps: () => waveMapList().map((m) => ({ id: m.id, name: m.name, thumbnail: null, players: waveRooms.players(m.id) })),
      leaderboard: (mapId, board) => waveScores.top(mapId, board),
    },
    config,
    logger,
    auth,
    tokens,
    kv,
    studio: {
      currencyPlayers: async (search) => {
        const result = await db.query(`SELECT a.id, a.username, COALESCE(p.coins, $3) AS coins,
          COALESCE((SELECT SUM((r.reward->>'quantity')::bigint) FROM survival_requisitions r WHERE r.account_id = a.id AND r.world_id = $1 AND NOT r.delivered AND r.reward->>'kind' = 'coins'), 0) AS pending_coins
          FROM accounts a LEFT JOIN player_states p ON p.account_id = a.id AND p.world_id = $1
          WHERE strpos(lower(a.username), lower($2)) > 0 OR a.id::text = $2
          ORDER BY a.username, a.id LIMIT 100`, [config.WORLD_ID, search, STARTING_ZCOIN]);
        return result.rows.map((r) => {
          const live = game.studioWallet(r.id);
          return { id: r.id, username: r.username, coins: live ?? r.coins, pendingCoins: Number(r.pending_coins), online: live !== undefined };
        });
      },
      grantCurrency: async (grant, actorId) => {
        const created = await progression.grantCoins(grant, actorId);
        if (created) audit.record({ event: 'studio.currency.grant', accountId: actorId, details: { ...grant, via: actorId ? 'account' : 'password' } });
        await game.receiveStudioCurrency(grant.accountId);
        return { requestId: grant.requestId, delivered: await progression.coinGrantDelivered(grant.requestId) };
      },
      playerCounts: async () => ({ online: game.playerCount, total: Number((await db.query('SELECT COUNT(*) AS total FROM player_states WHERE world_id = $1', [config.WORLD_ID])).rows[0]?.total ?? 0) }),
      playerProgress: async () => (await db.query('SELECT a.id, a.username, p.quest_journal AS journal FROM player_states p JOIN accounts a ON a.id = p.account_id WHERE p.world_id = $1 ORDER BY a.username', [config.WORLD_ID])).rows,
      resetPlayerProgress: (accountId) => game.resetPlayerProgress(accountId),
      getContent: () => game.content,
      saveContent: async (content) => {
        await db.query('INSERT INTO game_content (world_id, content) VALUES ($1, $2::jsonb) ON CONFLICT (world_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()', [config.WORLD_ID, JSON.stringify(content)]);
        game.applyContent(content);
      },
      get: () => {
        const camp = world.generator.camp;
        return {
          parts: world.campLayout,
          npcs: campNpcs ?? { merchant: { ...NPC_STALLS.merchant }, nurse: { ...NPC_STALLS.nurse }, guards: GUARD_POSTS.map((p) => ({ x: p.x, z: p.z })) },
          customised: world.campCustomised,
          camp: camp ? { x: camp.x, y: camp.y, z: camp.z, halfSize: CAMP_HALF_SIZE } : null,
          updatedAt: campUpdatedAt,
        };
      },
      infectionMaps: () => infectionMaps.maps,
      saveInfectionMap: (map) => infectionMaps.save(map),
      deleteInfectionMap: (id) => infectionMaps.remove(id),
      activateInfectionMap: (id) => infectionMaps.activate(id),
      previewInfectionMap: (map) => infectionMaps.preview(map),
      vehiclePhysics: () => ({ jolt: game.vehicleJolt }),
      setVehiclePhysics: async (jolt) => {
        game.vehicleJolt = jolt; vehicleJolt = jolt;
        for (const match of battlePool.matches) match.vehicleJolt = jolt;
        await db.query(`INSERT INTO server_settings (key, value) VALUES ('vehicle_physics', $1::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ jolt })]);
        audit.record({ event: 'studio.vehicle_physics', details: { jolt } });
        return { jolt };
      },
      characterStyle: () => ({ style: characterLook, blocky: characterLook === 'blocky' }),
      setCharacterStyle: async (style) => {
        characterLook = style;
        await db.query(`INSERT INTO server_settings (key, value) VALUES ('character_style', $1::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ style })]);
        audit.record({ event: 'studio.character_style', details: { style } });
        return { style, blocky: style === 'blocky' };
      },
      terrain: () => {
        const gen = world.generator;
        const camp = gen.camp;
        if (!camp) return null;
        // 1 m grid over ±72 m, heights relative to the camp floor (cached: the ground never changes).
        if (!terrainCache) {
          const origin = -72;
          const size = 145;
          const heights: number[] = new Array(size * size);
          for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
            heights[j * size + i] = Math.round((gen.heightAt(camp.x + origin + i, camp.z + origin + j) - camp.y) * 100) / 100;
          }
          terrainCache = { size, step: 1, origin, heights, water: gen.seaLevel - camp.y };
        }
        return terrainCache;
      },
      save: async (parts, npcs, accountId) => {
        await campLayouts.save(parts, npcs, accountId);
        campUpdatedAt = new Date().toISOString();
        campNpcs = npcs;
        game.applyCampLayout(parts);
        game.applyCampNpcs(npcs);
        audit.record({ event: 'studio.save', ...(accountId ? { accountId } : {}), details: { parts: parts.length, via: accountId ? 'account' : 'password' } });
      },
      reset: async () => {
        await campLayouts.clear();
        campUpdatedAt = null;
        campNpcs = null;
        game.applyCampLayout(null);
        game.applyCampNpcs(null);
      },
    },
    health: {
      async ready(): Promise<HealthReport> {
        const checks: HealthReport['checks'] = {};
        try {
          await db.query('SELECT 1');
          checks.database = { ok: true };
        } catch (err) {
          checks.database = { ok: false, detail: (err as Error).message };
        }
        checks.kv = { ok: await kv.ping(), detail: kv.kind };
        checks.worldgen = { ok: world.healthy, detail: `${world.readyWorkers} workers, queue ${world.queueLength}` };
        const tick = metrics.tickStats();
        checks.simulation = { ok: tick.p99 < 100, detail: `p99 ${tick.p99.toFixed(1)} ms` };
        return { ok: Object.values(checks).every((c) => c.ok), checks };
      },
      metrics: () =>
        metrics.render({
          chunk_cache_entries: world.cacheSize,
          chunk_queue_length: world.queueLength,
          chunks_generated_total: world.stats.generated,
          physics_chunks_loaded: game.physics.loadedCount,
          ...game.physicsProfile(),
          world_time_of_day: Number(game.timeOfDay().toFixed(4)),
          ws_sessions: gateway?.connectionCount ?? 0,
        }),
    },
  });

  gateway = new GameGateway(config, logger, metrics, auth, game, audit, { 'battle-royale': battlePool, infection: infectionPool }, (accountId) => battleTeams.forAccount(accountId)?.id);
  gateway.battleMaps = (id) => battleMaps.pool(id);
  gateway.infectionMaps = infectionPoolFor;
  gateway.waves = (map, party, bots) => waveRooms.source(map, party, bots);
  const voice = new VoiceHub({
    consumeTicket: async (ticket) => { const t = await auth.consumeTicket(ticket); return t ? { accountId: t.accountId, name: t.username } : null; },
    teamOf: (kind, accountId) => (kind === 'battle-royale' ? battleTeams : kind === 'waves' ? waveTeams : teams).forAccount(accountId)?.id,
    ice: { stun: config.VOICE_STUN_URLS, turn: config.TURN_URLS, secret: config.TURN_SECRET },
  }, logger);
  voice.start();
  gateway.voice = voice;
  gateway.attach(app.server);
  game.start();
  battlePool.start();
  infectionPool.start();
  waveRooms.start();
  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ port: config.PORT, worldId: config.WORLD_ID, seed: worldConfig.seed }, 'ZION server listening');

  const purge = setInterval(() => {
    refreshTokens.purgeExpired().catch((err: unknown) => logger.error({ err }, 'token purge failed'));
  }, 6 * 3600_000);
  purge.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');
    const force = setTimeout(() => {
      logger.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      gateway?.stopAccepting();
      await game.stop();
      await battlePool.stop();
      await battleMaps.close();
      await infectionPool.stop();
      await waveRooms.stop();
      await gateway?.close();
      await app.close();
      await world.close();
      await battleWorld.close();
      await infectionMaps.close();
      await audit.close();
      await kv.close();
      await db.end();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
