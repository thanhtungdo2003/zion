import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerGameRoutes } from './game';
import type { HttpDeps } from '../app';

describe('map atlas endpoint', () => {
  it('requires an authenticated player before serving cartography', async () => {
    const app = Fastify(), atlas = vi.fn(async () => ({ worldId: 'test', size: 512, pixels: 1, rgb: 'AAAA', structures: [] }));
    app.decorate('requireAuth', async (req, reply) => { if (!req.headers.authorization) await reply.code(401).send({ error: 'unauthorized' }); });
    registerGameRoutes(app, { atlas } as unknown as HttpDeps);
    try {
      expect((await app.inject('/api/game/atlas')).statusCode).toBe(401); expect(atlas).not.toHaveBeenCalled();
      const result = await app.inject({ url: '/api/game/atlas', headers: { authorization: 'player' } });
      expect(result.statusCode).toBe(200); expect(result.json().worldId).toBe('test');
    } finally { await app.close(); }
  });
});
