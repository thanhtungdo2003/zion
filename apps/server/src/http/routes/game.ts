import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type GameMode } from '@zion/shared';
import type { HttpDeps } from '../app';

export function registerGameRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const schema = { querystring: { type: 'object', properties: { mode: { type: 'string', enum: ['survival', 'battle-royale', 'infection'] } }, additionalProperties: false } };
  if (deps.atlas) app.get<{ Querystring: { mode?: GameMode } }>('/api/game/atlas', { schema, preHandler: app.requireAuth, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return deps.atlas!(req.query.mode);
  });
  if (deps.atlasTile) app.get<{ Params: { x: string; z: string }; Querystring: { mode?: GameMode } }>('/api/game/atlas/:x/:z', {
    schema,
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 180, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { x, z } = req.params;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(z)) return reply.code(400).send({ error: 'Invalid map tile' });
    try {
      const tile = await deps.atlasTile!(Number(x), Number(z), req.query.mode);
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
