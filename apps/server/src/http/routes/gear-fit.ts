import type { FastifyInstance } from 'fastify';
import type { HttpDeps } from '../app';

/** The Studio's gear fitting for game clients (read-only; the Studio saves it under /api/studio). */
export function registerGearFitRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const store = deps.gearFit;
  if (!store) return;
  app.get('/api/gear-fit', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return store.get();
  });
}
