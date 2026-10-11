import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { registerStudioRoutes } from './studio';
import type { HttpDeps } from '../app';

const payload = { requestId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', amount: 500, reason: 'Thưởng sự kiện' };
function setup() {
  const app = Fastify();
  const currencyPlayers = vi.fn(async () => []);
  const grantCurrency = vi.fn(async () => ({ requestId: payload.requestId, delivered: true }));
  app.decorate('requireAuth', async (req, reply) => {
    if (!req.headers.authorization) { await reply.code(401).send({ error: 'unauthorized' }); return; }
    req.claims = { sub: 'operator', name: 'Operator', role: req.headers.authorization === 'admin' ? 'admin' : 'player', guest: false };
  });
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: 'invalid_request' }));
  registerStudioRoutes(app, { config: { NODE_ENV: 'production', JWT_SECRET: 'test-secret', STUDIO_PASSWORD: 'studio-password' }, studio: { currencyPlayers, grantCurrency } } as unknown as HttpDeps);
  return { app, currencyPlayers, grantCurrency };
}

describe('Studio currency administration', () => {
  it('requires Studio access for both player search and credits', async () => {
    const { app, currencyPlayers, grantCurrency } = setup();
    try {
      for (const route of ['/api/studio/currency/players', '/api/studio/currency/grant']) {
        const options = route.endsWith('grant') ? { method: 'POST' as const, payload } : {};
        expect((await app.inject({ url: route, ...options })).statusCode).toBe(401);
        expect((await app.inject({ url: route, headers: { authorization: 'player' }, ...options })).statusCode).toBe(403);
      }
      expect(currencyPlayers).not.toHaveBeenCalled(); expect(grantCurrency).not.toHaveBeenCalled();
      const result = await app.inject({ url: '/api/studio/currency/players?search=%20Survivor%20', headers: { authorization: 'admin' } });
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(currencyPlayers).toHaveBeenCalledWith('Survivor');
      const credited = await app.inject({ method: 'POST', url: '/api/studio/currency/grant', headers: { authorization: 'admin' }, payload });
      expect(credited.json()).toEqual({ requestId: payload.requestId, delivered: true });
      expect(grantCurrency).toHaveBeenCalledWith(payload, 'operator');
    } finally { await app.close(); }
  });

  it('accepts a Studio password session without requiring a game account', async () => {
    const { app, grantCurrency } = setup();
    try {
      const login = await app.inject({ method: 'POST', url: '/api/studio/login', payload: { password: 'studio-password' } });
      const result = await app.inject({ method: 'POST', url: '/api/studio/currency/grant', headers: { 'x-studio-token': login.json().token }, payload });
      expect(result.statusCode).toBe(200);
      expect(grantCurrency).toHaveBeenCalledWith(payload, null);
    } finally { await app.close(); }
  });

  it('rejects negative, zero, fractional, oversized and tampered credit requests', async () => {
    const { app, grantCurrency } = setup();
    try {
      const invalid = [-1, 0, 1.5, 1_000_001].map((amount) => ({ ...payload, amount }));
      invalid.push({ ...payload, accountId: 'invalid' }, { ...payload, requestId: '' });
      for (const body of [...invalid, { ...payload, actorId: 'someone-else' }]) {
        expect((await app.inject({ method: 'POST', url: '/api/studio/currency/grant', headers: { authorization: 'admin' }, payload: body })).statusCode).toBe(400);
      }
      expect(grantCurrency).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
