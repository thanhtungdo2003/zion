import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { rankTitle } from '@zion/shared';
import { registerCareerRoutes } from './career';
import type { HttpDeps } from '../app';

describe('account career routes', () => {
  it('uses authenticated identity, returns only a title and blocks transfer errors', async () => {
    const app = Fastify();
    app.decorate('requireAuth', async (req, reply) => {
      if (!req.headers.authorization) { await reply.code(401).send({ error: 'unauthorized' }); return; }
      req.claims = { sub: 'mine', name: 'Player', role: 'player', guest: true };
    });
    const view = vi.fn(async () => ({ rank: rankTitle(6), armory: [], milestones: [], pendingSurvival: 0 }));
    const deploy = vi.fn(async () => { throw new Error('Not owned'); });
    registerCareerRoutes(app, { progression: { view, deploy } } as unknown as HttpDeps);
    try {
      expect((await app.inject('/api/career')).statusCode).toBe(401);
      const headers = { authorization: 'mine' };
      const result = await app.inject({ url: '/api/career', headers });
      expect(view).toHaveBeenCalledWith('mine');
      expect(result.json().rank.title).toBe('Binh Nhì II');
      expect(result.headers['cache-control']).toBe('no-store');
      const transfer = await app.inject({ method: 'POST', url: '/api/career/deploy', headers, payload: { key: '11111111-1111-4111-8111-111111111111' } });
      expect(transfer.statusCode).toBe(409);
      expect(deploy).toHaveBeenCalledWith('mine', '11111111-1111-4111-8111-111111111111');
    } finally { await app.close(); }
  });
});
