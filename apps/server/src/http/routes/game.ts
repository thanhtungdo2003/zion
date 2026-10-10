import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@zion/shared';
import type { HttpDeps } from '../app';

export function registerGameRoutes(app: FastifyInstance, deps: HttpDeps): void {
  if (deps.atlas) app.get('/api/game/atlas', { preHandler: app.requireAuth, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'private, max-age=300');
    return deps.atlas!();
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
