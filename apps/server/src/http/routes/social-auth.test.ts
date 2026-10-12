import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { registerSocialAuthRoutes } from './social-auth';
import { AuthError, type Session } from '../../security/auth-service';
import type { SocialAuth } from '../../security/social-auth';
import type { HttpDeps } from '../app';

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function setup() {
  const app = Fastify(); apps.push(app); await app.register(cookie);
  app.decorate('requireAuth', async (req, reply) => {
    if (req.headers.authorization !== 'Bearer original-token') { await reply.code(401).send({ error: 'unauthorized' }); return; }
    req.claims = { sub: 'original-id', name: 'Tên Cũ', role: 'player', guest: true };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_request' });
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code });
    return reply.code(500).send({ error: 'internal' });
  });
  const social = {
    available: vi.fn(() => ({ google: true, facebook: false })),
    start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.google.com/authorize', browser: 'browser-secret' })),
    finish: vi.fn(async () => ({ accessToken: 'access-secret', refreshToken: 'refresh-secret', account: { id: 'original-id' } } as Session)),
  };
  const auth = { refreshTtlSec: 86400, linkedProviders: vi.fn(async () => ['google']) };
  registerSocialAuthRoutes(app, { auth, config: { COOKIE_SECURE: true, ALLOW_GUEST: true, PUBLIC_WEB_URL: 'https://game.example.com' } } as unknown as HttpDeps, social as unknown as SocialAuth);
  return { app, social, auth };
}

describe('social sign-in HTTP', () => {
  it('exposes availability and protects the identity list/link action', async () => {
    const { app, social } = await setup();
    expect((await app.inject('/api/auth/providers')).json()).toEqual({ providers: { google: true, facebook: false }, guest: true });
    expect((await app.inject('/api/auth/identities')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/oauth/google/link', payload: {} })).statusCode).toBe(401);
    expect(social.start).not.toHaveBeenCalled();
  });
  it('binds linking to the bearer account and an httpOnly callback cookie', async () => {
    const { app, social, auth } = await setup();
    const headers = { authorization: 'Bearer original-token' };
    expect((await app.inject({ url: '/api/auth/identities', headers })).json()).toEqual({ providers: ['google'] });
    expect(auth.linkedProviders).toHaveBeenCalledWith('original-id');
    const response = await app.inject({ method: 'POST', url: '/api/auth/oauth/google/link', headers, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(social.start).toHaveBeenCalledWith('google', expect.anything(), 'original-id');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.json()).toEqual({ authorizationUrl: 'https://accounts.google.com/authorize' });
    expect((await app.inject({ method: 'POST', url: '/api/auth/oauth/google/link', headers, payload: { accountId: 'victim' } })).statusCode).toBe(400);
  });
  it('redirects to the fixed menu with a session cookie and no tokens in the URL', async () => {
    const { app, social } = await setup();
    const response = await app.inject({ url: '/api/auth/oauth/google/callback?state=state&code=code&returnTo=https://evil.example', cookies: { zion_oauth_google: 'browser-secret' } });
    expect(social.finish).toHaveBeenCalledWith('google', 'state', 'browser-secret', 'code', expect.anything());
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://game.example.com/?auth=success');
    expect(String(response.headers['set-cookie'])).toContain('zion_rt=refresh-secret');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('preserves the old refresh cookie after denied or conflicting links', async () => {
    const { app, social } = await setup();
    social.finish.mockRejectedValueOnce(new AuthError('identity_taken', 409, 'already linked'));
    const response = await app.inject({ url: '/api/auth/oauth/google/callback?state=state&error=access_denied', cookies: { zion_oauth_google: 'browser-secret', zion_rt: 'old-refresh' } });
    expect(response.headers.location).toBe('https://game.example.com/?auth_error=identity_taken');
    expect(String(response.headers['set-cookie'])).not.toContain('zion_rt');
    expect(social.finish).toHaveBeenCalledWith('google', 'state', 'browser-secret', undefined, expect.anything());
  });
});
