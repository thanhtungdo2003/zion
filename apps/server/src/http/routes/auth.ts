import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import type { RequestContext, Session } from '../../security/auth-service';
import { registerSocialAuthRoutes } from './social-auth';

const REFRESH_COOKIE = 'zion_rt';

const username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,20}$/, 'username must be 3–20 characters: letters, digits, underscore');
const password = z.string().min(10, 'password must be at least 10 characters').max(128);
const credentialsSchema = z.object({ username, password }).strict();
const guestSchema = z.object({
  username: z.string().trim().transform((name) => name.normalize('NFC'))
    .pipe(z.string().min(3).max(20).regex(/^[\p{L}\p{N}_ -]+$/u, 'name must contain only letters, digits, spaces, underscores or hyphens')),
}).strict();

function ctx(req: FastifyRequest): RequestContext {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua : null };
}

/**
 * Cookie-authenticated endpoints additionally require a custom header (forces a CORS preflight,
 * so cross-site forms cannot trigger them) and an allowed Origin when one is sent.
 */
function assertCsrf(req: FastifyRequest, deps: HttpDeps): boolean {
  if (req.headers['x-zion-csrf'] !== '1') return false;
  const origin = req.headers.origin;
  return !origin || deps.config.CORS_ORIGINS.includes(origin);
}

export function registerAuthRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const { auth, config } = deps;

  const sendSession = (reply: FastifyReply, s: Session) => {
    reply.setCookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: auth.refreshTtlSec,
    });
    reply.header('cache-control', 'no-store');
    return reply.send({ accessToken: s.accessToken, expiresIn: s.expiresIn, account: s.account });
  };

  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  registerSocialAuthRoutes(app, deps);

  app.post('/api/auth/register', strict, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    return sendSession(reply, await auth.register(body.username, body.password, ctx(req)));
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    return sendSession(reply, await auth.login(body.username, body.password, ctx(req)));
  });

  app.post('/api/auth/guest', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = guestSchema.parse(req.body);
    return sendSession(reply, await auth.guest(ctx(req), body.username));
  });

  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!assertCsrf(req, deps)) return reply.code(403).send({ error: 'csrf', message: 'missing CSRF header' });
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return reply.code(401).send({ error: 'invalid_token', message: 'no session' });
    try {
      return sendSession(reply, await auth.refresh(token, ctx(req)));
    } catch (err) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (!assertCsrf(req, deps)) return reply.code(403).send({ error: 'csrf', message: 'missing CSRF header' });
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: app.requireAuth }, async (req) => {
    const c = req.claims!;
    return { id: c.sub, username: c.name, role: c.role, guest: c.guest };
  });
}
