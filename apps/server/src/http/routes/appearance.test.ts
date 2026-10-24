import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE, type Appearance } from '@zion/shared';
import { registerAppearanceRoutes } from './appearance';
import type { HttpDeps } from '../app';

describe('character appearance routes', () => {
  it('reads and saves only the signed-in account’s look, rejecting invalid looks', async () => {
    const app = Fastify();
    app.decorate('requireAuth', async (req, reply) => {
      if (!req.headers.authorization) { await reply.code(401).send({ error: 'unauthorized' }); return; }
      req.claims = { sub: 'mine', name: 'Player', role: 'player', guest: true };
    });
    const saved = new Map<string, Appearance>();
    const loadAppearance = vi.fn(async (id: string) => saved.get(id) ?? null);
    const saveAppearance = vi.fn(async (id: string, a: Appearance) => { saved.set(id, a); });
    registerAppearanceRoutes(app, { appearances: { loadAppearance, saveAppearance } } as unknown as HttpDeps);
    try {
      expect((await app.inject('/api/appearance')).statusCode).toBe(401);
      const headers = { authorization: 'mine' };
      const first = await app.inject({ url: '/api/appearance', headers });
      expect(first.json()).toEqual({ appearance: null });
      expect(first.headers['cache-control']).toBe('no-store');
      const look = { ...DEFAULT_APPEARANCE, hair: 'buzz', height: 40 };
      const put = await app.inject({ method: 'PUT', url: '/api/appearance', headers, payload: { appearance: look } });
      expect(put.statusCode).toBe(200);
      expect(saveAppearance).toHaveBeenCalledWith('mine', look);
      expect((await app.inject({ url: '/api/appearance', headers })).json()).toEqual({ appearance: look });
      // Out-of-range sliders, unknown fields and unknown haircuts are refused.
      for (const bad of [{ ...look, height: 500 }, { ...look, extra: 1 }, { ...look, hair: 'mohawk' }]) {
        const r = await app.inject({ method: 'PUT', url: '/api/appearance', headers, payload: { appearance: bad } });
        expect(r.statusCode).toBeGreaterThanOrEqual(400);
      }
      expect(saveAppearance).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
