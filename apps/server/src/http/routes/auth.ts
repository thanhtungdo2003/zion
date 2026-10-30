import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { AuthError, type RequestContext, type Session } from '../../security/auth-service';
import { registerSocialAuthRoutes } from './social-auth';
import { randomToken, sha256 } from '../../security/tokens';

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

  // Desktop app sign-in through the website: the app asks for a request (id + secret), opens the
  // website in the system browser, where the signed-in player confirms it (the short code shown
  // on both sides), then the app collects its session with the secret.
  const desktopId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  app.post('/api/auth/desktop/start', strict, async (req, reply) => {
    z.object({}).strict().parse(req.body);
    const id = randomToken(), secret = randomToken();
    const code = sha256(id).toString('hex').slice(0, 6).toUpperCase();
    if (!await deps.kv.putIfAbsent(`desktop:${id}`, JSON.stringify({ secretHash: sha256(secret).toString('hex') }), 600)) throw new Error('desktop sign-in unavailable');
    const url = new URL('/', config.PUBLIC_WEB_URL);
    url.searchParams.set('desktop', id);
    url.searchParams.set('code', code);
    reply.header('cache-control', 'no-store');
    return { id, secret, code, url: url.toString(), expiresIn: 600 };
  });
  app.post('/api/auth/desktop/approve', { ...strict, preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: desktopId }).strict().parse(req.body);
    const pending = await deps.kv.take(`desktop:${id}`);
    if (!pending) return reply.code(404).send({ error: 'expired', message: 'Yêu cầu đăng nhập đã hết hạn. Hãy bấm đăng nhập lại trên ứng dụng.' });
    const { secretHash } = JSON.parse(pending) as { secretHash: string };
    await deps.kv.putIfAbsent(`desktop-ok:${id}`, JSON.stringify({ secretHash, accountId: req.claims!.sub }), 300);
    return { ok: true };
  });
  app.post('/api/auth/desktop/poll', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id, secret } = z.object({ id: desktopId, secret: desktopId }).strict().parse(req.body);
    const ready = await deps.kv.take(`desktop-ok:${id}`);
    reply.header('cache-control', 'no-store');
    if (!ready) return reply.code(202).send({ pending: true });
    const grant = JSON.parse(ready) as { secretHash: string; accountId: string };
    if (grant.secretHash !== sha256(secret).toString('hex')) {
      // Not this request's app: put the grant back for the right one.
      await deps.kv.putIfAbsent(`desktop-ok:${id}`, ready, 300);
      return reply.code(403).send({ error: 'forbidden', message: 'invalid desktop sign-in' });
    }
    return sendSession(reply, await auth.sessionFor(grant.accountId, ctx(req)));
  });

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
      // Only a refused token ends the session: a server error (database busy, restarting) keeps
      // the cookie so the client's retry still signs the player back in.
      if (err instanceof AuthError) reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (!assertCsrf(req, deps)) return reply.code(403).send({ error: 'csrf', message: 'missing CSRF header' });
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return reply.code(204).send();
  });

  app.post('/api/account/name', { preHandler: app.requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = guestSchema.parse(req.body);
    reply.header('cache-control', 'no-store');
    return reply.send(await auth.rename(req.claims!.sub, body.username, ctx(req)));
  });

  app.get('/api/me', { preHandler: app.requireAuth }, async (req) => {
    const c = req.claims!;
    return { id: c.sub, username: c.name, role: c.role, guest: c.guest };
  });
}
