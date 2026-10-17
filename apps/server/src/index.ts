import type { LifeWorld } from './game/base-life';
import { BATTLE_MAP, INFECTION_MAP, SQUAD_LIMIT, STARTING_ZCOIN, validateContent } from '@zion/shared';
import { randomInt } from 'node:crypto';
import { createDefaultRegistry } from '@zion/assets';
import { GENERATOR_VERSION, normalizeSeed, type WorldConfig } from '@zion/worldgen';
import { loadConfig } from './config';
import { defaultMigrationsDir, migrate } from './db/migrate';
import { createPool } from './db/pool';
import { GameGateway } from './game/gateway';
import { MatchPool } from './game/match-pool';
import { GameServer } from './game/game-server';
import { TeamService } from './game/teams';
import { CustomWeaponStore } from './repositories/custom-weapons';
import { ProgressionService } from './game/progression';
import { atlasProvider, atlasTileProvider } from './world/atlas';
import { buildHttpApp } from './http/app';
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
  const auth = new AuthService(new AccountRepository(db), refreshTokens, tokens, kv, audit, {
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
    allowGuest: config.ALLOW_GUEST,
  });

  const progression = new ProgressionService(db, config.WORLD_ID);
  await progression.initialize();
  const playerStates = new PlayerStateRepository(db, config.WORLD_ID, progression);
  // Studio weapons join the shared weapon/item/shop tables before any game server starts.
  const customWeapons = new CustomWeaponStore(db);
  await customWeapons.load((id, err) => logger.warn({ id, err }, 'custom weapon skipped (invalid definition)'));
  const teams = new TeamService(await playerStates.loadTeams(), (id, team, player) => playerStates.saveTeam(id, team, player));
  const game = new GameServer({
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

  const battleWorld = new WorldService({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'battle-royale' }, registry, Math.min(1, config.WORLDGEN_WORKERS), config.CHUNK_CACHE_SIZE, logger);
  await battleWorld.start();
  // Battle royale squads are separate from survival teams: three players, kept in memory.
  const battleTeams = new TeamService([], async () => {}, { limit: SQUAD_LIMIT, squad: true });
  // Battle royale and infection run many matches at once over one shared world each; every
  // "Play" is matched into a match still gathering players (see MatchPool).
  let vehicleJolt: boolean | null = null;
  const battlePool = new MatchPool(() => {
    const match = new GameServer({ teams: battleTeams, config, logger, metrics: new Metrics(), audit, world: battleWorld, registry, playerStates, worlds, worldId: BATTLE_MAP.id, initialWorldTimeMs: 0, mode: 'battle-royale' });
    if (vehicleJolt !== null) match.vehicleJolt = vehicleJolt;
    return match;
  }, logger.child({ module: 'battle-matches' }));
  // Infection ("Lây Nhiễm"): the small walled night town, its own rooms of humans and bots.
  const infectionWorld = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'infection' }, registry, 1, config.CHUNK_CACHE_SIZE, logger);
  await infectionWorld.start();
  const infectionPool = new MatchPool(() => new GameServer({ config, logger, metrics: new Metrics(), audit, world: infectionWorld, registry, playerStates, worlds, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0, mode: 'infection' }), logger.child({ module: 'infection-matches' }));
  const survivalAtlas = atlasProvider(world.generator, config.WORLD_ID, () => world.campLayout);
  const battleAtlas = atlasProvider(battleWorld.generator, BATTLE_MAP.id);
  const survivalTiles = atlasTileProvider(world.generator, config.WORLD_ID);
  const battleTiles = atlasTileProvider(battleWorld.generator, BATTLE_MAP.id);
  const infectionAtlas = atlasProvider(infectionWorld.generator, INFECTION_MAP.id);
  const infectionTiles = atlasTileProvider(infectionWorld.generator, INFECTION_MAP.id);

  const savedLife = await db.query<{ state: LifeWorld }>('SELECT state FROM world_base_life WHERE world_id = $1', [config.WORLD_ID]);
  if (savedLife.rows[0]) game.lifeWorld = savedLife.rows[0].state;
  const savedContent = await db.query<{ content: unknown }>('SELECT content FROM game_content WHERE world_id = $1', [config.WORLD_ID]);
  if (savedContent.rows[0]) {
    const parsed = validateContent(savedContent.rows[0].content);
    if (!parsed.ok) throw new Error(`Invalid persisted game content: ${parsed.errors.join('; ')}`);
    game.applyContent(parsed.content);
  }

  // Studio switches persisted across restarts.
  try {
    const physics = await db.query<{ value: { jolt?: boolean } }>(`SELECT value FROM server_settings WHERE key = 'vehicle_physics'`);
    const jolt = physics.rows[0]?.value.jolt;
    if (typeof jolt === 'boolean') { game.vehicleJolt = jolt; vehicleJolt = jolt; }
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

  const app = await buildHttpApp({
    news: new NewsRepository(db),
    customWeapons,
    progression,
    atlas: mode => mode === 'battle-royale' ? battleAtlas() : mode === 'infection' ? infectionAtlas() : survivalAtlas(),
    atlasTile: (x, z, mode) => mode === 'battle-royale' ? battleTiles(x, z) : mode === 'infection' ? infectionTiles(x, z) : survivalTiles(x, z),
    teams,
    battleTeams,
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
      vehiclePhysics: () => ({ jolt: game.vehicleJolt }),
      setVehiclePhysics: async (jolt) => {
        game.vehicleJolt = jolt; vehicleJolt = jolt;
        for (const match of battlePool.matches) match.vehicleJolt = jolt;
        await db.query(`INSERT INTO server_settings (key, value) VALUES ('vehicle_physics', $1::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ jolt })]);
        audit.record({ event: 'studio.vehicle_physics', details: { jolt } });
        return { jolt };
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
          world_time_of_day: Number(game.timeOfDay().toFixed(4)),
          ws_sessions: gateway?.connectionCount ?? 0,
        }),
    },
  });

  gateway = new GameGateway(config, logger, metrics, auth, game, audit, { 'battle-royale': battlePool, infection: infectionPool }, (accountId) => battleTeams.forAccount(accountId)?.id);
  gateway.attach(app.server);
  game.start();
  battlePool.start();
  infectionPool.start();
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
      await infectionPool.stop();
      await gateway?.close();
      await app.close();
      await world.close();
      await battleWorld.close();
      await infectionWorld.close();
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
