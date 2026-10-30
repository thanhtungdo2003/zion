import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { AppConfig } from '../config';
import type { KeyValueStore } from '../infra/kv';
import type { Logger } from '../logger';
import { AuthError, type AuthService } from '../security/auth-service';
import type { AccessClaims, TokenService } from '../security/tokens';
import { registerAuthRoutes } from './routes/auth';
import { registerAppearanceRoutes } from './routes/appearance';
import { registerTeamRoutes } from './routes/teams';
import { registerWorldChatRoutes } from './routes/world-chat';
import { registerCareerRoutes } from './routes/career';
import type { ProgressionService } from '../game/progression';
import type { TeamService } from '../game/teams';
import type { AtlasTile, GameMode, WorldAtlas } from '@zion/shared';
import { registerGameRoutes } from './routes/game';
import { registerHealthRoutes, type HealthProvider } from './routes/health';
import { registerStudioRoutes, type StudioBackend } from './routes/studio';
import type { NewsBackend } from '../repositories/news';
import { registerLibraryRoutes } from './routes/library';
import { registerWeaponRoutes } from './routes/weapons';
import type { CustomWeaponStore } from '../repositories/custom-weapons';
import type { GearFitStore } from '../repositories/gear-fit';
import type { HandStudioStore } from '../repositories/hand-studio';
import { registerGearFitRoutes } from './routes/gear-fit';
import { registerDesktopRoutes } from './routes/desktop';
import { registerWaveRoutes, type WaveBackend } from './routes/waves';
import { registerModelStudioRoutes, type ModelStudioDeps } from './routes/model-studio';
import type { AppearanceStore } from '../repositories/accounts';

export interface HttpDeps {
  /** Character looks (the creator's save/load). */
  appearances?: AppearanceStore;
  /** Weapons made in the Studio (definitions + model files). */
  customWeapons?: CustomWeaponStore;
  /** Gear fitting from the Studio (adjustments, soft regions). */
  gearFit?: GearFitStore;
  handStudio?: HandStudioStore;
  news?: NewsBackend;
  progression?: ProgressionService;
  config: AppConfig;
  logger: Logger;
  auth: AuthService;
  teams?: TeamService;
  /** Battle royale squads (separate lobby, max 3). */
  battleTeams?: TeamService;
  /** Wave survival parties (separate lobby, max 4, a map picked by the leader). */
  waveTeams?: TeamService;
  atlas?: (mode?: GameMode, map?: string) => Promise<WorldAtlas>;
  atlasTile?: (x: number, z: number, mode?: GameMode, map?: string) => Promise<AtlasTile>;
  /** Battle royale maps from the World Studio (map picker, publishing). */
  battleMaps?: { list(): unknown; publish(input: unknown): Promise<unknown>; remove(id: string): Promise<void>; catalog(): Promise<unknown>; stored(id: string): Promise<unknown | null>; setWarfare(id: string, layout: unknown): Promise<unknown> };
  /** Zombie Wave Survival maps and leaderboards. */
  waves?: WaveBackend;
  /** Warfare parties (max 4, one side) and the maps Warfare is on. */
  warfareTeams?: TeamService;
  warfare?: { maps(): Array<{ id: string; name: string; thumbnail: string | null; players: number }> };
  /** Infection maps for the menu's map picker. */
  infectionMapList?: () => unknown;
  /** Map models uploaded for Infection maps (Studio list / upload, files for everyone). */
  infectionModels?: { list(): unknown; upload(name: string, glb: Buffer, fit?: unknown): Promise<unknown>; file(asset: number): Promise<Buffer | null> };
  tokens: TokenService;
  kv: KeyValueStore;
  health: HealthProvider;
  /** Camp Studio backend (absent = studio routes disabled). */
  studio?: StudioBackend;
  /** Model Studio (projects, AI agent, published models). */
  modelStudio?: ModelStudioDeps;
}

declare module 'fastify' {
  interface FastifyRequest {
    claims?: AccessClaims;
  }
}

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 20_000,
    keepAliveTimeout: 65_000,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 128 },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    // Pure JSON API: nothing should ever be rendered or framed from it.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  const allowed = new Set(config.CORS_ORIGINS);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients send no Origin; browsers must match the allowlist exactly.
      if (!origin || allowed.has(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', 'x-zion-csrf', 'x-studio-token'],
    maxAge: 600,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    ...(deps.kv.redis ? { redis: deps.kv.redis, nameSpace: 'zion-rl:' } : {}),
    allowList: (req) => req.url.startsWith('/health/'),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `too many requests, retry in ${Math.ceil(ctx.ttl / 1000)}s`,
    }),
  });

  app.decorate('requireAuth', async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized', message: 'missing bearer token' });
    const claims = await deps.tokens.verifyAccess(header.slice(7).trim());
    if (!claims) return reply.code(401).send({ error: 'unauthorized', message: 'invalid or expired token' });
    req.claims = claims;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: err.issues[0]?.message ?? 'invalid request',
        field: err.issues[0]?.path.join('.'),
      });
    }
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled request error');
    return reply.code(500).send({ error: 'internal', message: 'internal server error' });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'not found' }));

  registerHealthRoutes(app, deps.health, config.METRICS_TOKEN);
  registerAuthRoutes(app, deps);
  registerAppearanceRoutes(app, deps);
  registerTeamRoutes(app, deps);
  registerWorldChatRoutes(app, deps);
  registerCareerRoutes(app, deps);
  registerGameRoutes(app, deps);
  registerLibraryRoutes(app, deps);
  registerWeaponRoutes(app, deps);
  registerGearFitRoutes(app, deps);
  registerDesktopRoutes(app, config.DESKTOP_UPDATE_DIR);
  registerWaveRoutes(app, deps);
  if (deps.warfare) {
    const warfare = deps.warfare;
    app.get('/api/warfare/maps', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => { reply.header('cache-control', 'no-store'); return { maps: warfare.maps() }; });
  }
  if (deps.handStudio) {
    const store = deps.handStudio;
    // The Studio's hand poses and animations for game clients (read-only; saved under /api/studio).
    app.get('/api/hand-studio', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      return store.get();
    });
  }
  registerStudioRoutes(app, deps);
  if (deps.modelStudio) registerModelStudioRoutes(app, deps, deps.modelStudio);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
