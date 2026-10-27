import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: bool.default('false'),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: bool.default('false'),
    DB_MIGRATE_ON_START: bool.default('true'),
    REDIS_URL: z.string().url().optional(),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('zion'),
    JWT_AUDIENCE: z.string().default('zion-game'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool.optional(),
    ALLOW_GUEST: bool.default('true'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    FACEBOOK_APP_ID: z.string().min(1).optional(),
    FACEBOOK_APP_SECRET: z.string().min(1).optional(),

    CORS_ORIGINS: csv.default('http://localhost:3000'),
    PUBLIC_WS_URL: z.string().url().default('ws://localhost:4000/ws'),
    TRUST_PROXY: bool.default('false'),
    METRICS_TOKEN: z.string().min(16).optional(),
    /** Camp Studio password; unset = studio only for admin/moderator accounts. */
    STUDIO_PASSWORD: z.string().min(1).max(200).optional(),
    /** Folder with the desktop app's content updates (apps/desktop/release/update); unset = none. */
    DESKTOP_UPDATE_DIR: z.string().min(1).optional(),
    /** Team voice: STUN servers (comma separated), and the TURN relay (coturn with use-auth-secret). */
    VOICE_STUN_URLS: csv.default('stun:stun.l.google.com:19302'),
    TURN_URLS: csv.optional(),
    TURN_SECRET: z.string().min(16).optional(),

    WORLD_ID: z.string().regex(/^[a-z0-9_-]{1,32}$/).default('main'),
    WORLD_SEED: z.string().max(128).optional(),
    WORLD_SIZE_CHUNKS: z.coerce.number().int().min(16).max(512).default(128),
    DAY_LENGTH_MINUTES: z.coerce.number().min(1).max(24 * 60).default(24),
    RANDOM_TICK_SPEED: z.coerce.number().int().min(0).max(1000).default(3),
    WORLDGEN_WORKERS: z.coerce.number().int().min(0).max(32).default(2),
    CHUNK_CACHE_SIZE: z.coerce.number().int().min(256).max(200_000).default(12_000),

    MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100_000).default(500),
    MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(6),
    WS_UPGRADES_PER_IP_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(20),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (/change[-_]?me|example|secret|dev|replace/i.test(cfg.JWT_SECRET) || cfg.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET looks like a placeholder; set a strong random value (32+ chars) in production');
    }
    if (cfg.STUDIO_PASSWORD !== undefined && cfg.STUDIO_PASSWORD.length < 16) {
      throw new Error('STUDIO_PASSWORD must be at least 16 characters in production (or unset to disable the studio password)');
    }
    if (cfg.CORS_ORIGINS.some((o) => o === '*')) throw new Error('CORS_ORIGINS must not be "*" in production');
  }
  return cfg;
}
