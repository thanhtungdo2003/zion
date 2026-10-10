import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@zion/shared';
import type { HttpDeps } from '../app';

export function registerGameRoutes(app: FastifyInstance, deps: HttpDeps): void {
  if (deps.atlas) app.get('/api/game/atlas', { preHandler: app.requireAuth, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return deps.atlas!();
  });
  if (deps.atlasTile) app.get<{ Params: { x: string; z: string } }>('/api/game/atlas/:x/:z', {
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 180, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { x, z } = req.params;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(z)) return reply.code(400).send({ error: 'Invalid map tile' });
    try {
      const tile = await deps.atlasTile!(Number(x), Number(z));
      reply.header('cache-control', 'private, max-age=300');
      return tile;
    } catch (error) {
      if (error instanceof RangeError) return reply.code(400).send({ error: 'Map tile outside world' });
      throw error;
    }
  });
  app.post(
    '/api/game/ticket',
    { preHandler: app.requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { ticket, expiresIn } = await deps.auth.issueTicket(req.claims!);
      reply.header('cache-control', 'no-store');
      return { ticket, expiresIn, wsUrl: deps.config.PUBLIC_WS_URL, protocolVersion: PROTOCOL_VERSION };
    },
  );
}
