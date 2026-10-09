import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@zion/shared';
import type { HttpDeps } from '../app';

export function registerGameRoutes(app: FastifyInstance, deps: HttpDeps): void {
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
