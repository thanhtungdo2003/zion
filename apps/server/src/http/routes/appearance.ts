import type { FastifyInstance } from 'fastify';
import { appearanceSchema } from '@zion/shared';
import type { HttpDeps } from '../app';

/** The account's character look: read by the menu and the creator, saved by the creator. */
export function registerAppearanceRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const store = deps.appearances;
  if (!store) return;
  app.get('/api/appearance', { preHandler: app.requireAuth }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { appearance: await store.loadAppearance(req.claims!.sub) };
  });
  app.put('/api/appearance', { preHandler: app.requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const appearance = appearanceSchema.parse((req.body as { appearance?: unknown } | null)?.appearance);
    await store.saveAppearance(req.claims!.sub, appearance);
    reply.header('cache-control', 'no-store');
    return { appearance };
  });
}
