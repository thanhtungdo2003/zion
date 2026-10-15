import type { FastifyInstance } from 'fastify';
import type { CustomWeaponList } from '@zion/shared';
import type { HttpDeps } from '../app';
import { modelUrl } from '../../repositories/custom-weapons';

/** Studio-made weapons for game clients: definitions, and each model file (versioned URL). */
export function registerWeaponRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const store = deps.customWeapons;
  if (!store) return;
  app.get('/api/weapons', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply): Promise<CustomWeaponList> => {
    reply.header('cache-control', 'no-store');
    return { weapons: store.list().map((w) => ({ ...w.def, modelUrl: modelUrl(w) })) };
  });
  app.get<{ Params: { id: string } }>('/api/weapons/:id/model', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!/^[a-z0-9_]{2,33}$/.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const model = await store.model(req.params.id);
    if (!model) return reply.code(404).send({ error: 'not_found' });
    // Loaded by the game page (another origin) through fetch / WebGL.
    reply.header('cross-origin-resource-policy', 'cross-origin');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.type(model.format === 'glb' ? 'model/gltf-binary' : 'application/json');
    return reply.send(model.bytes);
  });
}
