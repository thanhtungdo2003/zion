import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';

export function registerCareerRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const career = deps.progression;
  if (!career) return;
  app.get('/api/career', { preHandler: app.requireAuth }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return career.view(req.claims!.sub);
  });
  app.post('/api/career/deploy', { preHandler: app.requireAuth }, async (req, reply) => {
    const { key } = z.object({ key: z.string().uuid() }).strict().parse(req.body);
    try { await career.deploy(req.claims!.sub, key); }
    catch (err) { return reply.code(409).send({ error: 'requisition_unavailable', message: err instanceof Error ? err.message : 'Không thể chuyển vật phẩm.' }); }
    return career.view(req.claims!.sub);
  });
}
