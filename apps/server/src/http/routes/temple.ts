import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { studioGuard } from './studio';
import { TempleLive, type TempleMessage } from '../../temple/live';

/**
 * Chánh Điện (studio tab + game screen). Public: the status, the graphics and an SSE stream of
 * TikTok events, so the game screen needs no login (an OBS source, a phone). Studio only:
 * connect / disconnect a TikTok username, test events and the graphics.
 */
export function registerTempleRoutes(app: FastifyInstance, deps: HttpDeps, live = new TempleLive('temple-settings.json')): TempleLive {
  const guard = studioGuard(app, deps);
  const read = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const write = { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.get('/api/temple/status', read, async (_req, reply) => { reply.header('cache-control', 'no-store'); return { status: live.status, graphics: live.graphics }; });

  // Server-sent events: the current status and graphics first, then every message as it comes.
  app.get('/api/temple/events', read, (req, reply) => {
    const headers = { ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' };
    reply.hijack();
    reply.raw.writeHead(200, headers as Record<string, string>);
    const send = (m: TempleMessage) => { reply.raw.write(`data: ${JSON.stringify(m)}\n\n`); };
    send({ type: 'status', status: live.status }); send({ type: 'graphics', graphics: live.graphics });
    const stop = live.subscribe(send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { clearInterval(ping); stop(); });
  });

  app.post('/api/studio/temple/connect', write, async (req) => {
    const { username } = z.object({ username: z.string().trim().regex(/^@?[A-Za-z0-9._]{2,24}$/) }).strict().parse(req.body);
    return { status: await live.connect(username) };
  });
  app.post('/api/studio/temple/disconnect', write, async () => { await live.disconnect(); return { status: live.status }; });
  app.post('/api/studio/temple/graphics', write, async (req) => {
    const body = z.object({
      renderScale: z.number().optional(), shadows: z.enum(['off', 'low', 'high']).optional(), shaders: z.boolean().optional(),
      brightness: z.number().optional(), maxPeople: z.number().optional(),
    }).strict().parse(req.body);
    return { graphics: live.setGraphics(body) };
  });
  // Test buttons: a made-up viewer (or one of a few repeat names) likes, follows, shares or chats.
  app.post('/api/studio/temple/test', write, async (req) => {
    const b = z.object({ kind: z.enum(['join', 'like', 'chat', 'follow', 'share']), likes: z.number().int().min(1).max(1000).optional(), name: z.string().max(40).optional(), comment: z.string().max(200).optional() }).strict().parse(req.body);
    const name = b.name?.trim() || `Khách ${1 + Math.floor(Math.random() * 40)}`;
    live.inject(b.kind, { id: `test:${name}`, name }, { ...(b.likes ? { likes: b.likes } : {}), ...(b.comment ? { comment: b.comment } : {}) });
    return { ok: true };
  });
  return live;
}
