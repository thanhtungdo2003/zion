import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContent, type GameContent } from '@zion/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CAMP_ASSET } from '@zion/assets';
import type { CampNpcLayout, CampPart } from '@zion/worldgen';
import type { HttpDeps } from '../app';

/** What the Camp Studio needs from the game: the live layout and a way to change it. */
export interface StudioBackend {
  playerCounts(): Promise<{ online: number; total: number }>;
  playerProgress(): Promise<unknown>;
  resetPlayerProgress(accountId?: string): Promise<void>;
  getContent(): GameContent;
  saveContent(content: GameContent): Promise<void>;
  get(): { parts: readonly CampPart[]; npcs: CampNpcLayout; customised: boolean; camp: { x: number; y: number; z: number; halfSize: number } | null; updatedAt: string | null };
  save(parts: CampPart[], npcs: CampNpcLayout | null, accountId: string | null): Promise<void>;
  /** Ground heights around the camp (relative to the camp floor), row-major `size × size`. */
  terrain(): { size: number; step: number; origin: number; heights: number[]; water: number } | null;
  reset(): Promise<void>;
}

const CAMP_IDS = new Set<number>(Object.values(CAMP_ASSET));
/** Parts may sit a little outside the wall (the outer wire runs at ±50 m). */
const MAX_OFFSET = 70;

const partSchema = z
  .object({
    asset: z.number().int().refine((a) => CAMP_IDS.has(a), 'unknown camp asset'),
    x: z.number().finite().min(-MAX_OFFSET).max(MAX_OFFSET),
    y: z.number().finite().min(-2).max(30),
    z: z.number().finite().min(-MAX_OFFSET).max(MAX_OFFSET),
    yaw: z.number().finite().min(-100).max(100),
    scale: z.number().finite().min(0.5).max(2),
    group: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

const spot = z.object({ x: z.number().finite().min(-MAX_OFFSET).max(MAX_OFFSET), z: z.number().finite().min(-MAX_OFFSET).max(MAX_OFFSET) }).strict();
const npcsSchema = z.object({ merchant: spot, nurse: spot, guards: z.array(spot).max(8) }).strict();
const layoutSchema = z.object({ parts: z.array(partSchema).max(3000), npcs: npcsSchema.optional() }).strict();

/** Studio access: admins/moderators; outside production any registered (non-guest) account. */
function canEdit(req: FastifyRequest, production: boolean): boolean {
  const c = req.claims;
  if (!c) return false;
  if (c.role === 'admin' || c.role === 'moderator') return true;
  return !production && !c.guest;
}

/** Studio password sessions: `expiry.signature`, HMAC'd with the JWT secret. */
const STUDIO_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();

function sign(secret: string, exp: number): string {
  return createHmac('sha256', secret).update(`studio:${exp}`).digest('base64url');
}

function issueToken(secret: string): { token: string; expiresAt: number } {
  const exp = Date.now() + STUDIO_TOKEN_TTL_MS;
  return { token: `${exp}.${sign(secret, exp)}`, expiresAt: exp };
}

function validToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const [e, sig] = token.split('.');
  const exp = Number(e);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(sign(secret, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

function samePassword(a: string, b: string): boolean {
  // Hash both so the comparison is constant-time regardless of length.
  const ha = createHmac('sha256', 'studio-pw').update(a).digest();
  const hb = createHmac('sha256', 'studio-pw').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function registerStudioRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const studio = deps.studio;
  if (!studio) return;
  const production = deps.config.NODE_ENV === 'production';
  const password = deps.config.STUDIO_PASSWORD;
  const secret = deps.config.JWT_SECRET;
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    // A studio password session is enough on its own (no game account needed).
    const token = req.headers['x-studio-token'];
    if (password && validToken(secret, typeof token === 'string' ? token : undefined)) return;
    await app.requireAuth(req, reply);
    if (reply.sent) return;
    if (!canEdit(req, production)) return reply.code(403).send({ error: 'forbidden', message: 'Camp Studio requires the studio password' });
  };

  if (deps.progression) {
    app.get('/api/studio/ranks', { preHandler: guard }, async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      return deps.progression!.config;
    });
    app.post('/api/studio/ranks', { preHandler: guard }, async (req) => deps.progression!.configure(req.body));
  }

  app.post('/api/studio/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password: given } = loginSchema.parse(req.body);
    if (!password || !samePassword(given, password)) {
      return reply.code(401).send({ error: 'invalid_password', message: 'wrong studio password' });
    }
    reply.header('cache-control', 'no-store');
    return issueToken(secret);
  });

  app.get('/api/studio/players', { preHandler: guard }, async () => studio.playerProgress());
  app.get('/api/studio/player-counts', { preHandler: guard }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return studio.playerCounts();
  });
  app.post('/api/studio/players/reset', { preHandler: guard }, async (req, reply) => {
    const parsed = z.object({ accountId: z.string().uuid().optional(), all: z.boolean().optional() }).strict().safeParse(req.body);
    if (!parsed.success || (!parsed.data.accountId && parsed.data.all !== true) || (parsed.data.accountId && parsed.data.all)) return reply.code(400).send({ error: 'invalid_scope' });
    await studio.resetPlayerProgress(parsed.data.accountId);
    return { ok: true };
  });
  app.get('/api/studio/content', { preHandler: guard }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return studio.getContent();
  });
  app.post('/api/studio/content', { preHandler: guard, bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const result = validateContent(req.body);
    if (!result.ok) return reply.code(400).send({ error: 'invalid_content', message: result.errors.join('\n'), errors: result.errors });
    const content = result.content;
    const life = content.baseLife;
    const models = [...Object.values(life?.itemModels ?? {}), ...content.npcs.map((n) => n.model), ...(life?.plots ?? []).map((p) => p.model), ...(life?.stations ?? []).map((p) => p.model), ...(life?.decorations ?? []).map((p) => p.model), ...(life?.animals ?? []).map((p) => p.model), ...(life?.crops ?? []).flatMap((c) => c.stages)];
    const here = path.dirname(fileURLToPath(import.meta.url));
    const roots = [path.resolve(here, '../../../../web/public'), path.resolve(process.cwd(), '../web/public'), path.resolve(process.cwd(), 'apps/web/public')];
    const missing = [...new Set(models)].filter((model) => !roots.some((root) => existsSync(path.join(root, model.slice(1)))));
    if (missing.length) return reply.code(400).send({ error: 'invalid_content', message: `Missing models: ${missing.join(', ')}` });
    await studio.saveContent(content);
    return studio.getContent();
  });

  app.get('/api/studio/layout', { preHandler: guard }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return studio.get();
  });

  app.post(
    '/api/studio/layout',
    { preHandler: guard, bodyLimit: 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { parts, npcs } = layoutSchema.parse(req.body);
      await studio.save(parts, npcs ?? null, req.claims?.sub ?? null);
      return studio.get();
    },
  );

  app.get('/api/studio/terrain', { preHandler: guard }, async (_req, reply) => {
    const t = studio.terrain();
    if (!t) return reply.code(404).send({ error: 'not_found', message: 'this world has no camp' });
    reply.header('cache-control', 'private, max-age=300');
    return t;
  });

  app.post('/api/studio/reset', { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => {
    await studio.reset();
    return studio.get();
  });
}
