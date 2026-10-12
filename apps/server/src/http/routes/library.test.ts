import Fastify from 'fastify';
import { ZodError } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT } from '@zion/shared';
import { registerLibraryRoutes } from './library';
import { registerStudioRoutes } from './studio';
import type { HttpDeps } from '../app';

describe('library and admin news routes', () => {
  it('makes published articles public, protects drafts and only accepts admin edits', async () => {
    const app = Fastify();
    const published = vi.fn(async () => []), drafts = vi.fn(async () => [{ id: 'secret-draft' }]), act = vi.fn(async () => null);
    app.decorate('requireAuth', async (req, reply) => {
      const role = req.headers.authorization;
      if (role !== 'admin' && role !== 'moderator' && role !== 'player') { await reply.code(401).send({ error: 'unauthorized' }); return; }
      req.claims = { sub: '09b43208-d339-484c-b4df-274fb42eb986', name: 'Admin', role, guest: false };
    });
    app.setErrorHandler((error, _req, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: 'invalid_request' }));
    const deps = { config: { NODE_ENV: 'production', JWT_SECRET: 'test-secret', STUDIO_PASSWORD: 'studio-password' }, news: { published, drafts, act }, studio: { getContent: () => DEFAULT_CONTENT } } as unknown as HttpDeps;
    registerLibraryRoutes(app, deps); registerStudioRoutes(app, deps);
    try {
      const publicFeed = await app.inject('/api/news');
      expect(publicFeed.statusCode).toBe(200); expect(publicFeed.json()).toEqual([]);
      expect(publicFeed.headers['cache-control']).toBe('no-store');
      expect((await app.inject('/api/handbook')).json().some((e: { id: string }) => e.id === 'npc.farmer')).toBe(true);
      expect((await app.inject('/api/studio/news')).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/studio/news', headers: { authorization: 'moderator' } })).statusCode).toBe(403);
      expect(drafts).not.toHaveBeenCalled();
      expect((await app.inject({ url: '/api/studio/news', headers: { authorization: 'admin' } })).json()).toEqual([{ id: 'secret-draft' }]);
      const action = { op: 'publish', id: '09b43208-d339-484c-b4df-274fb42eb986', revision: 1 };
      expect((await app.inject({ method: 'POST', url: '/api/studio/news', headers: { authorization: 'moderator' }, payload: action })).statusCode).toBe(403);
      expect(act).not.toHaveBeenCalled();
      expect((await app.inject({ method: 'POST', url: '/api/studio/news', headers: { authorization: 'admin' }, payload: { ...action, revision: 0 } })).statusCode).toBe(400);
      expect(act).not.toHaveBeenCalled();
      expect((await app.inject({ method: 'POST', url: '/api/studio/news', headers: { authorization: 'admin' }, payload: action })).statusCode).toBe(200);
      expect(act).toHaveBeenCalledWith(action, '09b43208-d339-484c-b4df-274fb42eb986');
      const login = await app.inject({ method: 'POST', url: '/api/studio/login', payload: { password: 'studio-password' } });
      expect((await app.inject({ url: '/api/studio/news', headers: { 'x-studio-token': login.json().token } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
});
