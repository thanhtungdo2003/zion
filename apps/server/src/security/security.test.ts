import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { TokenService, randomToken } from './tokens';
import { loadConfig } from '../config';

describe('password hashing', () => {
  it('verifies correct passwords and rejects wrong ones', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterz', h)).toBe(false);
  });

  it('salts hashes and rejects malformed or abusive parameters', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1073741824$8$1$c2FsdA$aGFzaA')).toBe(false); // N too large (DoS)
  });
});

describe('access tokens', () => {
  const svc = new TokenService('x'.repeat(40), 'zion', 'zion-game', 60);

  it('round-trips claims', async () => {
    const t = await svc.signAccess({ sub: 'abc', name: 'Neo', role: 'player', guest: false });
    expect(await svc.verifyAccess(t)).toEqual({ sub: 'abc', name: 'Neo', role: 'player', guest: false });
  });

  it('rejects tampered, foreign-key and wrong-audience tokens', async () => {
    const t = await svc.signAccess({ sub: 'abc', name: 'Neo', role: 'player', guest: false });
    const [h, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'admin' })).toString('base64url');
    expect(await svc.verifyAccess(`${h}.${forged}.${s}`)).toBeNull();
    const other = new TokenService('y'.repeat(40), 'zion', 'zion-game', 60);
    expect(await other.verifyAccess(t)).toBeNull();
    const aud = new TokenService('x'.repeat(40), 'zion', 'other-app', 60);
    expect(await aud.verifyAccess(t)).toBeNull();
    // alg=none must never verify.
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    expect(await svc.verifyAccess(none)).toBeNull();
  });

  it('generates 256-bit url-safe opaque tokens', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
});

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: 'k'.repeat(40) };

  it('applies defaults and parses lists', () => {
    const cfg = loadConfig({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.COOKIE_SECURE).toBe(false);
  });

  it('refuses weak or placeholder secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'please-change-me-'.repeat(3) })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/CORS/);
  });
});
