import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerStudioRoutes } from './studio';
import type { HttpDeps } from '../app';

describe('studio player counts', () => {
  it('requires studio access and returns fresh counts without caching', async () => {
    const app = Fastify();
    const playerCounts = vi.fn(async () => ({ online: 3, total: 27 }));
    app.decorate('requireAuth', async (req, reply) => {
      if (!req.headers.authorization) { await reply.code(401).send({ error: 'unauthorized' }); return; }
      req.claims = { sub: 'admin', name: 'Admin', role: 'admin', guest: false };
    });
    registerStudioRoutes(app, {
      config: { NODE_ENV: 'production', JWT_SECRET: 'test-secret' },
      studio: { playerCounts },
    } as unknown as HttpDeps);
    try {
      expect((await app.inject('/api/studio/player-counts')).statusCode).toBe(401);
      expect(playerCounts).not.toHaveBeenCalled();
      const headers = { authorization: 'admin' };
      const result = await app.inject({ url: '/api/studio/player-counts', headers });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ online: 3, total: 27 });
      expect(result.headers['cache-control']).toBe('no-store');
      playerCounts.mockResolvedValue({ online: 1, total: 28 });
      expect((await app.inject({ url: '/api/studio/player-counts', headers })).json()).toEqual({ online: 1, total: 28 });
    } finally { await app.close(); }
  });
});
