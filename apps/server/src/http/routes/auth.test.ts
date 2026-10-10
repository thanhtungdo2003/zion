import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { registerAuthRoutes } from './auth';
import { AuthError, AuthService, type Session } from '../../security/auth-service';
import { TokenService } from '../../security/tokens';
import { MemoryKeyValueStore } from '../../infra/kv';
import type { Account, AccountRepository } from '../../repositories/accounts';
import type { RefreshTokenRepository } from '../../repositories/refresh-tokens';
import type { AuditLog } from '../../repositories/audit';
import type { HttpDeps } from '../app';

const resources: Array<{ app: FastifyInstance; kv: MemoryKeyValueStore }> = [];
afterEach(async () => {
  for (const { app, kv } of resources.splice(0)) { await app.close(); await kv.close(); }
});

async function setup(allowGuest = true) {
  let account: Account | null = null;
  const create = vi.fn(async (username: string): Promise<Account | null> => {
    account = { id: 'guest-id', username, passwordHash: null, isGuest: true, role: 'player', failedLogins: 0, lockedUntil: null, bannedUntil: null, banReason: null };
    return account;
  });
  const accounts = { create, findById: vi.fn(async () => account) };
  const refreshTokens = { create: vi.fn(async () => 'refresh-id'), rotate: vi.fn(async () => ({ status: 'ok', accountId: 'guest-id', familyId: 'family-id', newId: 'next-id' })) };
  const kv = new MemoryKeyValueStore();
  const tokens = new TokenService('x'.repeat(40), 'zion', 'zion-game', 60);
  const auth = new AuthService(accounts as unknown as AccountRepository, refreshTokens as unknown as RefreshTokenRepository, tokens, kv, { record: vi.fn() } as unknown as AuditLog, { allowGuest, refreshTtlDays: 30 });
  const app = Fastify();
  resources.push({ app, kv });
  await app.register(cookie);
  app.decorate('requireAuth', async () => {});
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_request' });
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code });
    return reply.code(500).send({ error: 'internal' });
  });
  registerAuthRoutes(app, { auth, config: { COOKIE_SECURE: false, CORS_ORIGINS: [] } } as unknown as HttpDeps);
  return { app, auth, create, tokens };
}

describe('first-time player names', () => {
  it('normalizes and saves a Vietnamese name, then keeps it through refresh and game tickets', async () => {
    const { app, auth, create, tokens } = await setup();
    const name = 'Người Sống Sót';
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: { username: `  ${name.normalize('NFD')}  ` } });
    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith(name, null, true);
    const session = res.json<Omit<Session, 'refreshToken'>>();
    expect(session.account.username).toBe(name);
    expect((await tokens.verifyAccess(session.accessToken))?.name).toBe(name);
    expect(res.headers['set-cookie']).toBeDefined();
    const refreshed = await auth.refresh('a'.repeat(43), { ip: '127.0.0.1', userAgent: null });
    expect(refreshed.account.username).toBe(name);
    const claims = await tokens.verifyAccess(refreshed.accessToken);
    const ticket = await auth.issueTicket(claims!);
    expect((await auth.consumeTicket(ticket.ticket))?.username).toBe(name);
  });

  it.each([{}, { username: '' }, { username: '   ' }, { username: 'ab' }, { username: 'x'.repeat(21) }, { username: '<script>' }, { username: 'A\nB' }])('rejects invalid or missing names: %j', async (payload) => {
    const { app, create } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a taken name without issuing a session or creating another identity', async () => {
    const { app, create } = await setup();
    create.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: { username: 'Survivor' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'username_taken' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('still respects disabled guest access', async () => {
    const { app, create } = await setup(false);
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: { username: 'Survivor' } });
    expect(res.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
