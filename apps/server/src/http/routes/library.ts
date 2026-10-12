import type { FastifyInstance } from 'fastify';
import { buildHandbook } from '@zion/shared';
import type { HttpDeps } from '../app';

/** Main-menu reference pages are available before sign-in. Never expose drafts. */
export function registerLibraryRoutes(app: FastifyInstance, deps: HttpDeps): void {
  app.get('/api/handbook', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return buildHandbook(deps.studio?.getContent());
  });
  app.get('/api/news', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return deps.news ? deps.news.published() : [];
  });
}
