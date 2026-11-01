import { planRegion, regionRequestSchema } from '../../model-studio/region-planner';
import { classifyWithAi } from '../../model-studio/ai-classify';
import { parseDoc } from '@zion/assets/model-studio';
import { lotFitSchema } from '@zion/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { studioGuard } from './studio';
import type { ModelAgent } from '../../model-studio/agent';
import type { AiSettings } from '../../model-studio/ai-settings';
import type { TextureLibrary } from '../../model-studio/textures';
import { MAX_FILE_BYTES, type ModelStudioStore } from '../../model-studio/store';

/** What the Model Studio routes need. */
export interface ModelStudioDeps {
  store: ModelStudioStore;
  agent: ModelAgent;
  /** The agent's AI connection (key, endpoint, model) as set in the Studio. */
  ai?: AiSettings;
  /** Real texture sets (library and AI painting). */
  textures?: TextureLibrary;
  /** Model Studio houses on trial on the built-in battle royale island (applied at server start). */
  trial?: { get(): { active: number[]; saved: number[] }; set(assets: number[]): Promise<{ active: number[]; saved: number[]; restartRequired: boolean }> };
}

const id = z.string().uuid();
const LOT = z.enum(['residential', 'commercial', 'industrial', 'military', 'abandoned']);
const FILE_TYPE = 'application/x-model-file';

function fail(reply: FastifyReply, err: unknown) {
  const e = err as Error & { statusCode?: number; current?: number };
  const code = e.statusCode ?? (e instanceof z.ZodError ? 400 : /hợp lệ|định dạng|quá lớn|invalid|unknown|duplicate|Tối đa|hết chỗ/i.test(e.message) ? 400 : 500);
  return reply.code(code).send({ error: code === 409 ? 'conflict' : code === 404 ? 'not_found' : code >= 500 ? 'internal' : 'invalid', message: e.message, ...(e.current ? { current: e.current } : {}) });
}

/**
 * Model Studio API. Everything under /api/studio/models needs the Studio login; published model
 * files are public (game clients load them). Destructive or game-wide actions — deleting a
 * project, publishing or replacing a model, taking one out of the game — require `confirm: true`
 * from the admin and are reversible where they can be (soft delete, versions).
 */
export function registerModelStudioRoutes(app: FastifyInstance, deps: HttpDeps, ms: ModelStudioDeps): void {
  const guard = studioGuard(app, deps);
  const { store, agent } = ms;
  const pre = { preHandler: guard, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };
  app.addContentTypeParser(FILE_TYPE, { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES + 1024 }, (_req, body, done) => done(null, body));

  // --- Game side (public): published models.
  app.get('/api/model-assets', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return store.publishedList().map((m) => ({ asset: m.asset, name: m.name, version: m.version, def: m.def }));
  });
  app.get<{ Params: { file: string } }>('/api/model-assets/:file', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const m = /^(\d{4})\.glb$/.exec(req.params.file);
    const model = m ? store.publishedModel(Number(m[1])) : undefined;
    if (!model) return reply.code(404).send({ error: 'not_found', message: 'model not found' });
    // A copy the browser already has: answered before the (possibly big) file is read.
    const etag = `"${model.asset}-${model.version}"`;
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const glb = await store.publishedFile(model.asset);
    if (!glb) return reply.code(404).send({ error: 'not_found', message: 'model not found' });
    reply.header('etag', etag).header('cache-control', 'no-cache').type('model/gltf-binary');
    return reply.send(glb);
  });

  // --- Projects.
  app.get('/api/studio/models/status', pre, async () => ({ ai: agent.configured, model: agent.model, published: store.publishedList().length }));
  app.get<{ Querystring: { deleted?: string } }>('/api/studio/models/projects', pre, async (req, reply) => { reply.header('cache-control', 'no-store'); return store.list(req.query.deleted === '1'); });
  app.post('/api/studio/models/projects', { ...pre, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    try {
      const body = z.object({ name: z.string().min(1).max(80), doc: z.unknown().optional() }).strict().parse(req.body);
      return await store.create(body.name, body.doc);
    } catch (err) { return fail(reply, err); }
  });
  app.get<{ Params: { id: string } }>('/api/studio/models/projects/:id', pre, async (req, reply) => {
    if (!id.safeParse(req.params.id).success) return reply.code(404).send({ error: 'not_found', message: 'not found' });
    const p = await store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Dự án không tồn tại.' });
    reply.header('cache-control', 'no-store');
    return { ...p, files: await store.files(p.id) };
  });
  app.put<{ Params: { id: string } }>('/api/studio/models/projects/:id', { ...pre, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    try {
      const body = z.object({ doc: z.unknown(), baseVersion: z.number().int().min(1), snapshot: z.boolean().optional(), note: z.string().max(200).optional() }).strict().parse(req.body);
      return await store.save(id.parse(req.params.id), body.doc, body.baseVersion, { ...(body.snapshot ? { snapshot: true } : {}), ...(body.note ? { note: body.note } : {}) });
    } catch (err) { return fail(reply, err); }
  });
  app.post<{ Params: { id: string } }>('/api/studio/models/projects/:id/rename', pre, async (req, reply) => {
    try { await store.rename(id.parse(req.params.id), z.object({ name: z.string().min(1).max(80) }).strict().parse(req.body).name); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
  app.post<{ Params: { id: string } }>('/api/studio/models/projects/:id/duplicate', pre, async (req, reply) => {
    try { return await store.duplicate(id.parse(req.params.id)); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string }; Querystring: { confirm?: string; permanent?: string } }>('/api/studio/models/projects/:id', pre, async (req, reply) => {
    if (req.query.confirm !== '1') return reply.code(400).send({ error: 'confirm', message: 'Cần xác nhận xóa (confirm=1).' });
    try {
      if (req.query.permanent === '1') { await store.purge(id.parse(req.params.id)); return { ok: true, restorable: false }; }
      await store.remove(id.parse(req.params.id)); return { ok: true, restorable: true };
    } catch (err) { return fail(reply, err); }
  });
  app.post<{ Params: { id: string } }>('/api/studio/models/projects/:id/undelete', pre, async (req, reply) => {
    try { await store.restoreDeleted(id.parse(req.params.id)); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
  app.get<{ Params: { id: string } }>('/api/studio/models/projects/:id/versions', pre, async (req, reply) => {
    try { return await store.versions(id.parse(req.params.id)); } catch (err) { return fail(reply, err); }
  });
  app.get<{ Params: { id: string; version: string } }>('/api/studio/models/projects/:id/versions/:version', pre, async (req, reply) => {
    const doc = await store.versionDoc(req.params.id, Number(req.params.version)).catch(() => null);
    return doc ? { doc } : reply.code(404).send({ error: 'not_found', message: 'Không có phiên bản này.' });
  });
  app.post<{ Params: { id: string; version: string } }>('/api/studio/models/projects/:id/versions/:version/restore', pre, async (req, reply) => {
    try { return await store.restoreVersion(id.parse(req.params.id), Number(req.params.version)); } catch (err) { return fail(reply, err); }
  });

  // --- Files (raw bytes; name in the query).
  app.post<{ Querystring: { project?: string; name?: string } }>('/api/studio/models/files', { ...pre, bodyLimit: MAX_FILE_BYTES + 1024 }, async (req, reply) => {
    try {
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'invalid', message: `Gửi file với content-type ${FILE_TYPE}.` });
      const project = req.query.project ? id.parse(req.query.project) : null;
      return await store.addFile(project, (req.query.name ?? 'file').slice(0, 200), req.body);
    } catch (err) { return fail(reply, err); }
  });
  app.get<{ Params: { file: string } }>('/api/studio/models/files/:file', pre, async (req, reply) => {
    const f = await store.file(req.params.file);
    if (!f) return reply.code(404).send({ error: 'not_found', message: 'Không có file.' });
    reply.header('cache-control', 'private, max-age=86400, immutable').type(f.mime === 'model/gltf+json' ? 'model/gltf+json' : f.mime);
    return reply.send(f.bytes);
  });

  // --- Validate, export, publish.
  app.post('/api/studio/models/validate', { ...pre, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    try { const body = z.object({ doc: z.unknown(), project: id.optional() }).strict().parse(req.body); return store.validate(body.doc, body.project ? new Set((await store.files(body.project)).map((f) => f.id)) : undefined); }
    catch (err) { return fail(reply, err); }
  });
  app.post('/api/studio/models/export', { ...pre, bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const body = z.object({ doc: z.unknown(), mode: z.enum(['game', 'editable']), embedAssets: z.boolean().optional() }).strict().parse(req.body);
      const report = store.validate(body.doc);
      if (report.issues.some((i) => i.code === 'schema')) return reply.code(400).send({ error: 'invalid', message: report.issues[0]!.message });
      const out = await store.exportDoc(body.doc as never, body.mode, body.embedAssets ?? body.mode === 'editable');
      reply.header('x-export-warnings', encodeURIComponent(JSON.stringify(out.warnings.slice(0, 20)))).header('x-export-triangles', String(out.triangles)).header('x-export-refs', String(out.refs.length));
      reply.header('content-disposition', `attachment; filename="model.glb"`).type('model/gltf-binary');
      return reply.send(Buffer.from(out.glb.buffer, out.glb.byteOffset, out.glb.byteLength));
    } catch (err) { return fail(reply, err); }
  });
  app.get('/api/studio/models/published', pre, async (_req, reply) => { reply.header('cache-control', 'no-store'); return store.publishedList(); });
  app.post<{ Params: { id: string } }>('/api/studio/models/projects/:id/publish', { ...pre, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const body = z.object({ confirm: z.literal(true), replaceAsset: z.number().int().optional(), lotClass: LOT.optional(), fit: lotFitSchema.optional(), version: z.number().int().optional() }).strict().parse(req.body);
      const r = await store.publish(id.parse(req.params.id), { ...(body.replaceAsset !== undefined ? { replaceAsset: body.replaceAsset } : {}), ...(body.lotClass ? { lotClass: body.lotClass } : {}), ...(body.fit ? { fit: body.fit } : {}), ...(body.version ? { version: body.version } : {}) });
      req.log.info({ asset: r.asset, project: req.params.id }, 'model studio: published');
      return r;
    } catch (err) { return fail(reply, err); }
  });
  // World Studio: what a drawn region should be (kind, condition, style, name) and which published
  // buildings it takes — the Model Studio's AI when connected, rules of thumb otherwise.
  app.post('/api/studio/world/plan-region', { ...pre, bodyLimit: 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    try { return await planRegion(regionRequestSchema.parse(req.body), store.publishedList(), ms.ai?.client() ?? null); } catch (err) { return fail(reply, err); }
  });
  // "Tự phân loại": the AI sorts the model out (rules of thumb without an AI connection).
  app.post('/api/studio/models/classify', { ...pre, bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    try { return await classifyWithAi(parseDoc((req.body as { doc?: unknown } | null)?.doc), ms.ai?.client() ?? null); } catch (err) { return fail(reply, err); }
  });
  app.put<{ Params: { asset: string } }>('/api/studio/models/published/:asset/fit', pre, async (req, reply) => {
    try { return await store.setFit(Number(req.params.asset), lotFitSchema.parse((req.body as { fit?: unknown } | null)?.fit)); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { asset: string }; Querystring: { confirm?: string } }>('/api/studio/models/published/:asset', pre, async (req, reply) => {
    if (req.query.confirm !== '1') return reply.code(400).send({ error: 'confirm', message: 'Cần xác nhận gỡ model khỏi game (confirm=1).' });
    await store.unpublish(Number(req.params.asset));
    return { ok: true };
  });

  // --- AI connection. The key goes in, never out (only its last four characters).
  app.get('/api/studio/models/ai', pre, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return ms.ai?.status() ?? { configured: agent.configured, source: agent.configured ? 'env' : null, keyHint: null, baseUrl: '', model: agent.model ?? '' };
  });
  app.put('/api/studio/models/ai', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      if (!ms.ai) return reply.code(501).send({ error: 'unavailable', message: 'Không hỗ trợ.' });
      const body = z.object({
        apiKey: z.string().max(400).regex(/^[!-~]*$/, 'API key chỉ gồm ký tự in được, không có khoảng trắng.').optional(),
        baseUrl: z.union([z.literal(''), z.string().url().max(300).refine((u) => /^https?:\/\//.test(u), 'Địa chỉ phải là http(s).')]).optional(),
        model: z.string().max(120).regex(/^[\w.:/@-]*$/, 'Tên model không hợp lệ.').optional(),
        imageModel: z.string().max(120).regex(/^[\w.:/@-]*$/, 'Tên model không hợp lệ.').optional(),
      }).strict().parse(req.body);
      const status = await ms.ai.update(body);
      req.log.info({ source: status.source, model: status.model, baseUrl: status.baseUrl, keyChanged: body.apiKey !== undefined }, 'model studio: AI settings changed');
      return status;
    } catch (err) { return fail(reply, err); }
  });
  app.get('/api/studio/models/ai/models', { ...pre, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return ms.ai ? ms.ai.listModels() : { models: agent.model ? [agent.model] : [], error: null };
  });

  // --- Texture library (search, thumbnails, download into a project) and AI painting.
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/studio/models/textures', pre, async (req, reply) => {
    if (!ms.textures) return reply.code(501).send({ error: 'unavailable', message: 'Không hỗ trợ.' });
    try { return { results: await ms.textures.search(String(req.query.q ?? '').slice(0, 120), Number(req.query.limit) || 24), canPaint: ms.textures.canPaint }; }
    catch (err) { return fail(reply, err); }
  });
  app.get<{ Params: { id: string } }>('/api/studio/models/textures/:id/thumb', { ...pre, config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const img = await ms.textures?.thumbnail(req.params.id).catch(() => null);
    if (!img) return reply.code(404).send({ error: 'not_found', message: 'Không có ảnh.' });
    reply.header('cache-control', 'private, max-age=86400').type('image/png');
    return reply.send(img);
  });
  app.post('/api/studio/models/textures/download', { ...pre, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!ms.textures) return reply.code(501).send({ error: 'unavailable', message: 'Không hỗ trợ.' });
    try {
      const body = z.object({ project: id, id: z.string().regex(/^[a-z0-9_]{2,80}$/), resolution: z.enum(['1k', '2k']).optional() }).strict().parse(req.body);
      return await ms.textures.download(body.project, body.id, body.resolution ?? '1k');
    } catch (err) { return fail(reply, err); }
  });
  app.post('/api/studio/models/textures/paint', { ...pre, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!ms.textures) return reply.code(501).send({ error: 'unavailable', message: 'Không hỗ trợ.' });
    try {
      const body = z.object({ project: id, prompt: z.string().min(8).max(600), roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional() }).strict().parse(req.body);
      return await ms.textures.paint(body.project, body.prompt, { ...(body.roughness !== undefined ? { roughness: body.roughness } : {}), ...(body.metalness !== undefined ? { metalness: body.metalness } : {}) });
    } catch (err) { return fail(reply, err); }
  });

  // --- Trial on the built-in battle royale island.
  app.get('/api/studio/models/trial', pre, async () => ms.trial?.get() ?? { active: [], saved: [] });
  app.post('/api/studio/models/trial', pre, async (req, reply) => {
    try {
      const body = z.object({ assets: z.array(z.number().int()).max(16), confirm: z.literal(true) }).strict().parse(req.body);
      for (const a of body.assets) { const m = store.publishedModel(a); if (!m || m.def.category !== 'structure') return reply.code(400).send({ error: 'invalid', message: `#${a} không phải công trình đã xuất bản.` }); }
      if (!ms.trial) return reply.code(501).send({ error: 'unavailable', message: 'Không hỗ trợ.' });
      return await ms.trial.set(body.assets);
    } catch (err) { return fail(reply, err); }
  });

  // --- Agent.
  app.post('/api/studio/models/agent', { ...pre, bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const body = z.object({ project: id, prompt: z.string().min(3).max(4000), offline: z.boolean().optional() }).strict().parse(req.body);
      const p = await store.get(body.project);
      if (!p) return reply.code(404).send({ error: 'not_found', message: 'Dự án không tồn tại.' });
      const job = agent.start(p.id, body.prompt, p.doc, p.version, { ...(body.offline ? { offline: true } : {}) });
      return { job: job.id, mode: job.mode, model: job.model ?? null };
    } catch (err) { return fail(reply, err); }
  });
  /** The job on a project (running or last finished), so the Studio reattaches after a reload. */
  app.get<{ Querystring: { project?: string } }>('/api/studio/models/agent', pre, async (req) => {
    const j = req.query.project ? agent.latest(req.query.project) : undefined;
    return { job: j ? { id: j.id, status: j.status, prompt: j.prompt, finished: j.finishedAt !== undefined } : null };
  });
  app.get<{ Params: { job: string }; Querystring: { after?: string; doc?: string; rev?: string } }>('/api/studio/models/agent/:job', pre, async (req, reply) => {
    const job = agent.get(req.params.job);
    if (!job) return reply.code(404).send({ error: 'not_found', message: 'Không có tác vụ.' });
    reply.header('cache-control', 'no-store');
    const after = Number(req.query.after ?? 0) || 0;
    return {
      id: job.id, status: job.status, mode: job.mode, model: job.model ?? null, prompt: job.prompt,
      steps: job.steps.slice(after), total: job.steps.length, summary: job.summary ?? null, issues: job.issues ?? [],
      savedVersion: job.savedVersion ?? null, saveError: job.saveError ?? null, usage: job.usage,
      publishRequests: job.publishRequests.map((r) => ({ id: r.id, lotClass: r.lotClass ?? null, replaceAsset: r.replaceAsset ?? null, note: r.note })),
      revision: job.revision, finished: job.finishedAt !== undefined,
      // The work in progress while it runs (only when it changed since the caller's revision), the result after.
      ...((req.query.doc === '1' && job.status !== 'running') || (req.query.rev !== undefined && Number(req.query.rev) < job.revision) ? { doc: job.doc } : {}),
    };
  });
  app.post<{ Params: { job: string } }>('/api/studio/models/agent/:job/cancel', pre, async (req) => ({ ok: agent.cancel(req.params.job) }));
  /** The admin confirms (or drops) a publish the agent asked for. */
  app.post<{ Params: { job: string; request: string } }>('/api/studio/models/agent/:job/publish/:request', pre, async (req, reply) => {
    try {
      const body = z.object({ confirm: z.boolean() }).strict().parse(req.body);
      const job = agent.get(req.params.job);
      const r = agent.takePublishRequest(req.params.job, req.params.request);
      if (!job || !r) return reply.code(404).send({ error: 'not_found', message: 'Không có yêu cầu này.' });
      if (!body.confirm) return { ok: true, dropped: true };
      return await store.publish(job.projectId, { ...(r.replaceAsset ? { replaceAsset: r.replaceAsset } : {}), ...(r.lotClass && LOT.safeParse(r.lotClass).success ? { lotClass: r.lotClass } : {}) });
    } catch (err) { return fail(reply, err); }
  });
}
