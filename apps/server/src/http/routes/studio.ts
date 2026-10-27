import { randomUUID } from 'node:crypto';
import { MAX_MAP_MODEL_BYTES } from '../../world/infection-maps';
import { MAX_MAP_BOXES } from '@zion/assets';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltinWeapon, validateContent, type GameContent } from '@zion/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CAMP_ASSET, LIGHT_SOURCE_ASSET } from '@zion/assets';
import type { CampNpcLayout, CampPart } from '@zion/worldgen';
import type { HttpDeps } from '../app';
import { modelUrl } from '../../repositories/custom-weapons';
import { studioCurrencyGrantSchema, type StudioCurrencyGrant, type StudioCurrencyPlayer, type StudioCurrencyResult } from '@zion/shared';
import { newsActionSchema } from '@zion/shared';

/** What the Camp Studio needs from the game: the live layout and a way to change it. */
export interface StudioBackend {
  currencyPlayers(search: string): Promise<StudioCurrencyPlayer[]>;
  grantCurrency(grant: StudioCurrencyGrant, actorId: string | null): Promise<StudioCurrencyResult>;
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
  /** Vehicle physics engine for every game server (Jolt or the built-in arcade model). */
  /** Infection maps (Studio "Lây nhiễm" tab). */
  infectionMaps(): unknown;
  saveInfectionMap(map: unknown): Promise<unknown>;
  deleteInfectionMap(id: string): Promise<unknown>;
  activateInfectionMap(id: string): Promise<unknown>;
  previewInfectionMap(map: unknown): unknown;
  vehiclePhysics(): { jolt: boolean };
  setVehiclePhysics(jolt: boolean): Promise<{ jolt: boolean }>;
  /** Player character look for every client: the survivor model or the old block character. */
  characterStyle(): { style: CharacterStyle; blocky: boolean };
  setCharacterStyle(style: CharacterStyle): Promise<{ style: CharacterStyle; blocky: boolean }>;
}

/** Player character looks: the survivor, the survivor on the Mixamo skeleton (trial), the block character. */
export const CHARACTER_STYLES = ['survivor', 'mixamo', 'blocky'] as const;
export type CharacterStyle = (typeof CHARACTER_STYLES)[number];

const CAMP_IDS = new Set<number>([...Object.values(CAMP_ASSET), LIGHT_SOURCE_ASSET]);
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

  if (deps.news) {
    // Publishing is an admin capability. The shared Studio password also grants it.
    const newsGuard = async (req: FastifyRequest, reply: FastifyReply) => {
      const token = req.headers['x-studio-token'];
      if (password && validToken(secret, typeof token === 'string' ? token : undefined)) return;
      await app.requireAuth(req, reply);
      if (!reply.sent && req.claims?.role !== 'admin') return reply.code(403).send({ error: 'forbidden', message: 'Chỉ quản trị viên được quản lý bản cập nhật.' });
    };
    app.get('/api/studio/news', { preHandler: newsGuard }, async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      return deps.news!.drafts();
    });
    app.post('/api/studio/news', { preHandler: newsGuard, bodyLimit: 256 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const action = newsActionSchema.parse(req.body);
      const result = await deps.news!.act(action, req.claims?.sub ?? null);
      req.log.info({ postId: action.id, op: action.op, actorId: req.claims?.sub ?? 'studio-password' }, 'news publication changed');
      reply.header('cache-control', 'no-store');
      return result;
    });
  }

  if (deps.gearFit) {
    const store = deps.gearFit;
    app.post('/api/studio/gear-fit', { preHandler: guard, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      try {
        const saved = await store.save(req.body, req.claims?.sub ?? null);
        req.log.info({ actorId: req.claims?.sub ?? 'studio-password' }, 'gear fit saved');
        return saved;
      } catch (err) {
        if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        throw err;
      }
    });
  }

  if (deps.handStudio) {
    const store = deps.handStudio;
    app.post('/api/studio/hand-studio', { preHandler: guard, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      try {
        const saved = await store.save(req.body, req.claims?.sub ?? null);
        req.log.info({ actorId: req.claims?.sub ?? 'studio-password' }, 'hand studio saved');
        return saved;
      } catch (err) {
        if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        throw err;
      }
    });
  }

  if (deps.customWeapons) {
    const store = deps.customWeapons;
    const saveSchema = z.object({ def: z.record(z.unknown()), model: z.string().max(12 * 1024 * 1024).optional() }).strict();
    app.get('/api/studio/weapons', { preHandler: guard }, async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      return { weapons: store.list().map((w) => ({ ...w.def, modelUrl: modelUrl(w) })) };
    });
    // The model travels base64 in the JSON body (≤ 8 MB once decoded).
    app.post('/api/studio/weapons', { preHandler: guard, bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = saveSchema.parse(req.body);
      try {
        const saved = await store.save(body.def, body.model ? Buffer.from(body.model, 'base64') : null, req.claims?.sub ?? null);
        req.log.info({ weapon: saved.def.id, actorId: req.claims?.sub ?? 'studio-password' }, 'custom weapon saved');
        return { ...saved.def, modelUrl: modelUrl(saved) };
      } catch (err) {
        if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        return reply.code(400).send({ error: 'invalid', message: err instanceof Error ? err.message : 'Không lưu được vũ khí.' });
      }
    });
    app.delete<{ Params: { id: string } }>('/api/studio/weapons/:id', { preHandler: guard }, async (req, reply) => {
      if (!(await store.remove(req.params.id))) return reply.code(404).send({ error: 'not_found', message: 'Không tìm thấy vũ khí.' });
      req.log.info({ weapon: req.params.id, actorId: req.claims?.sub ?? 'studio-password' }, 'custom weapon deleted');
      return { ok: true };
    });
    // Back to the shipped defaults: the Studio password must be typed again, even mid-session.
    const resetSchema = z.object({ password: z.string().min(1).max(200), id: z.string().max(40).optional() }).strict();
    app.post('/api/studio/weapons/reset', { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { password: given, id } = resetSchema.parse(req.body);
      const password = deps.config.STUDIO_PASSWORD;
      if (!password || !samePassword(given, password)) return reply.code(403).send({ error: 'invalid_password', message: 'Sai mật khẩu Studio.' });
      if (id && !isBuiltinWeapon(id)) return reply.code(400).send({ error: 'invalid', message: 'Chỉ vũ khí có sẵn mới có mặc định.' });
      const ids = id ? [id] : store.list().map((w) => w.def.id).filter(isBuiltinWeapon);
      for (const w of ids) await store.remove(w);
      req.log.info({ weapons: ids, actorId: req.claims?.sub ?? 'studio-password' }, 'weapons reset to defaults');
      return { ok: true, reset: ids };
    });
  }

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
  app.get('/api/studio/currency/players', { preHandler: guard }, async (req, reply) => {
    const { search } = z.object({ search: z.string().trim().max(80).default('') }).strict().parse(req.query);
    reply.header('cache-control', 'no-store');
    return studio.currencyPlayers(search);
  });
  app.post('/api/studio/currency/grant', { preHandler: guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const grant = studioCurrencyGrantSchema.parse(req.body);
    reply.header('cache-control', 'no-store');
    return studio.grantCurrency(grant, req.claims?.sub ?? null);
  });
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

  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => reply.code(400).send({ error: 'invalid_request', message: err instanceof z.ZodError ? err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message });
  app.get('/api/studio/infection-maps', { preHandler: guard }, async () => studio.infectionMaps());
  app.put('/api/studio/infection-maps', { preHandler: guard, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    try { return await studio.saveInfectionMap(req.body); } catch (err) { return fail(reply, err); }
  });
  app.post('/api/studio/infection-maps/preview', { preHandler: guard, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    try { return studio.previewInfectionMap(req.body); } catch (err) { return fail(reply, err); }
  });
  app.post('/api/studio/infection-maps/active', { preHandler: guard }, async (req, reply) => {
    try { return await studio.activateInfectionMap(z.object({ id: z.string() }).strict().parse(req.body).id); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string } }>('/api/studio/infection-maps/:id', { preHandler: guard }, async (req, reply) => {
    try { return await studio.deleteInfectionMap(req.params.id); } catch (err) { return fail(reply, err); }
  });
  if (deps.infectionModels) {
    const models = deps.infectionModels;
    app.get('/api/studio/infection-maps/models', { preHandler: guard }, async () => ({ models: models.list() }));
    // The file first, as raw bytes (held a few minutes for the registration that follows).
    const pendingFiles = new Map<string, { glb: Buffer; at: number }>();
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_MAP_MODEL_BYTES + 1024 }, (_req, body, done) => done(null, body));
    app.post('/api/studio/infection-maps/models/file', { preHandler: guard, bodyLimit: MAX_MAP_MODEL_BYTES + 1024, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
      const glb = req.body as Buffer;
      if (!Buffer.isBuffer(glb) || glb.length < 20) return reply.code(400).send({ error: 'invalid', message: 'Không nhận được file GLB.' });
      const now = Date.now();
      for (const [k, v] of pendingFiles) if (now - v.at > 10 * 60_000) pendingFiles.delete(k);
      const upload = randomUUID();
      pendingFiles.set(upload, { glb, at: now });
      return { upload };
    });
    // A whole map as one GLB (sent before as raw bytes, or base64 in JSON): its collision is computed on upload.
    app.post('/api/studio/infection-maps/models', { preHandler: guard, bodyLimit: 96 * 1024 * 1024, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
      try {
        const body = z.object({ name: z.string().trim().min(1).max(60), upload: z.string().uuid().optional(), glb: z.string().min(16).optional(), fit: z.object({ offset: z.tuple([z.number(), z.number(), z.number()]), colliders: z.array(z.unknown()).max(MAX_MAP_BOXES), bounds: z.object({ radius: z.number().positive(), height: z.number().positive() }) }).optional() }).strict().parse(req.body);
        const file = body.upload ? pendingFiles.get(body.upload)?.glb : body.glb ? Buffer.from(body.glb, 'base64') : undefined;
        if (!file) return reply.code(400).send({ error: 'invalid', message: 'File GLB đã hết hạn, hãy tải lên lại.' });
        if (body.upload) pendingFiles.delete(body.upload);
        return await models.upload(body.name, file, body.fit);
      } catch (err) { return fail(reply, err); }
    });
    app.get<{ Params: { file: string } }>('/api/infection-maps/models/:file', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const m = /^(\d{4})\.glb$/.exec(req.params.file);
      const file = m ? await models.file(Number(m[1])) : null;
      if (!file) return reply.code(404).send({ error: 'not_found' });
      // Versioned URLs (?v=): a file never changes under its version.
      reply.header('content-type', 'model/gltf-binary').header('cache-control', (req.query as { v?: string }).v ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
      return reply.send(file);
    });
  }
  // Battle royale maps published from the World Studio (heightfield + buildings + flora: large bodies).
  if (deps.battleMaps) {
    app.post('/api/studio/battle-maps', { preHandler: guard, bodyLimit: 96 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      try { return await deps.battleMaps!.publish(req.body); } catch (err) { return fail(reply, err); }
    });
    app.delete<{ Params: { id: string } }>('/api/studio/battle-maps/:id', { preHandler: guard }, async (req, reply) => {
      try { await deps.battleMaps!.remove(req.params.id); return { ok: true }; } catch (err) { return fail(reply, err); }
    });
  }
  app.get('/api/studio/vehicle-physics', { preHandler: guard }, async () => studio.vehiclePhysics());
  app.post('/api/studio/vehicle-physics', { preHandler: guard }, async (req) => studio.setVehiclePhysics(z.object({ jolt: z.boolean() }).strict().parse(req.body).jolt));
  app.post('/api/studio/character-style', { preHandler: guard }, async (req) => studio.setCharacterStyle(z.object({ style: z.enum(CHARACTER_STYLES) }).strict().parse(req.body).style));
  app.get('/api/character-style', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return studio.characterStyle();
  });

  app.post('/api/studio/reset', { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => {
    await studio.reset();
    return studio.get();
  });
}
