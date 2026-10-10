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
  it('authenticates detail requests and validates coordinates before generating terrain', async () => {
    const app = Fastify(), atlasTile = vi.fn(async (x: number, z: number) => {
      if (x > 1 || z > 1) throw new RangeError();
      return { worldId: 'test', x: x * 256, z: z * 256, size: 256, pixels: 1, rgb: 'AAAA' };
    });
    app.decorate('requireAuth', async (req, reply) => { if (!req.headers.authorization) await reply.code(401).send({ error: 'unauthorized' }); });
    registerGameRoutes(app, { atlasTile } as unknown as HttpDeps);
    try {
      expect((await app.inject('/api/game/atlas/0/0')).statusCode).toBe(401);
      expect(atlasTile).not.toHaveBeenCalled();
      const headers = { authorization: 'player' };
      for (const coords of ['-1/0', '1.5/0', 'NaN/0', '999/0']) expect((await app.inject({ url: `/api/game/atlas/${coords}`, headers })).statusCode).toBe(400);
      expect(atlasTile).not.toHaveBeenCalled();
      expect((await app.inject({ url: '/api/game/atlas/2/0', headers })).statusCode).toBe(400);
      const result = await app.inject({ url: '/api/game/atlas/1/0', headers });
      expect(result.statusCode).toBe(200); expect(result.json().x).toBe(256);
    } finally { await app.close(); }
  });
});
