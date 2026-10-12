import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { SocialAuth } from '../../security/social-auth';
import { AuthError } from '../../security/auth-service';

const params = z.object({ provider: z.enum(['google', 'facebook']) });
const context = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] ?? null });

export function registerSocialAuthRoutes(app: FastifyInstance, deps: HttpDeps, social = new SocialAuth(deps.config, deps.kv, deps.auth)) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.get('/api/auth/providers', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { providers: social.available(), guest: deps.config.ALLOW_GUEST };
  });
  app.get('/api/auth/identities', { preHandler: app.requireAuth }, async req => ({ providers: await deps.auth.linkedProviders(req.claims!.sub) }));
  const start = async (req: FastifyRequest, reply: FastifyReply, link: boolean) => {
    const { provider } = params.parse(req.params);
    z.object({}).strict().parse(req.body);
    // The bearer-authenticated link endpoint binds the flow to this account before leaving the site.
    const flow = await social.start(provider, context(req), link ? req.claims!.sub : undefined);
    reply.setCookie(`zion_oauth_${provider}`, flow.browser, { httpOnly: true, secure: deps.config.COOKIE_SECURE, sameSite: 'lax', path: '/api/auth/oauth', maxAge: 300 });
    reply.header('cache-control', 'no-store');
    return { authorizationUrl: flow.authorizationUrl };
  };
  app.post('/api/auth/oauth/:provider/start', strict, (req, reply) => start(req, reply, false));
  app.post('/api/auth/oauth/:provider/link', { ...strict, preHandler: app.requireAuth }, (req, reply) => start(req, reply, true));
  app.get('/api/auth/oauth/:provider/callback', strict, async (req, reply) => {
    const { provider } = params.parse(req.params);
    const cookie = `zion_oauth_${provider}`;
    reply.clearCookie(cookie, { path: '/api/auth/oauth' });
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const destination = new URL('/', deps.config.PUBLIC_WEB_URL);
    try {
      const query = z.object({ state: z.string().max(128), code: z.string().max(4096).optional(), error: z.string().optional() }).parse(req.query);
      const session = await social.finish(provider, query.state, req.cookies[cookie], query.error ? undefined : query.code, context(req));
      // Callback redirects carry no access/refresh token. The frontend restores the httpOnly session.
      reply.setCookie('zion_rt', session.refreshToken, { httpOnly: true, secure: deps.config.COOKIE_SECURE, sameSite: 'strict', path: '/api/auth', maxAge: deps.auth.refreshTtlSec });
      destination.searchParams.set('auth', 'success');
    } catch (err) {
      destination.searchParams.set('auth_error', err instanceof AuthError ? err.code : 'oauth_failed');
    }
    return reply.redirect(destination.toString());
  });
}
