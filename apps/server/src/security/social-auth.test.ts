import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { MemoryKeyValueStore } from '../infra/kv';
import { SocialAuth } from './social-auth';
import { AuthService, type Session } from './auth-service';
import type { AppConfig } from '../config';
import type { AccountRepository, Account } from '../repositories/accounts';
import type { RefreshTokenRepository } from '../repositories/refresh-tokens';
import type { TokenService } from './tokens';
import type { AuditLog } from '../repositories/audit';

const stores: MemoryKeyValueStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); vi.useRealTimers(); });
let privateKey: KeyLike, keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
});
const ctx = { ip: '127.0.0.1', userAgent: 'test' };
const config = { PUBLIC_API_URL: 'https://api.example.com', GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret', FACEBOOK_APP_ID: 'fb-client', FACEBOOK_APP_SECRET: 'fb-secret' } as AppConfig;
function setup() {
  const kv = new MemoryKeyValueStore(); stores.push(kv);
  const auth = { checkAccount: vi.fn(async () => {}), social: vi.fn(async () => ({ account: { id: 'original-id' } } as Session)) };
  const fetcher = vi.fn<typeof fetch>();
  const social = new SocialAuth(config, kv, auth as unknown as AuthService, fetcher, keys);
  return { social, kv, auth, fetcher };
}
async function token(nonce: string, audience = 'google-client', issuer = 'https://accounts.google.com') {
  return new SignJWT({ nonce, name: 'Người Sống Sót' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('google-subject').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
function googleResponse(fetcher: ReturnType<typeof setup>['fetcher'], idToken: string) {
  fetcher.mockResolvedValueOnce(Response.json({ access_token: 'access', id_token: idToken }));
}

describe('social OAuth', () => {
  it('uses PKCE, signed Google ID tokens and the authenticated UUID when linking; state is single-use', async () => {
    const { social, auth, fetcher } = setup();
    const flow = await social.start('google', ctx, 'original-id'), url = new URL(flow.authorizationUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/auth/oauth/google/callback');
    expect(auth.checkAccount).toHaveBeenCalledWith('original-id', ctx);
    googleResponse(fetcher, await token(url.searchParams.get('nonce')!));
    const result = await social.finish('google', url.searchParams.get('state')!, flow.browser, 'code', ctx);
    expect(result.account.id).toBe('original-id');
    expect(auth.social).toHaveBeenCalledWith('google', 'google-subject', 'Người Sống Sót', ctx, 'original-id');
    const body = new URLSearchParams(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.get('code_verifier')).toHaveLength(43);
    await expect(social.finish('google', url.searchParams.get('state')!, flow.browser, 'code', ctx)).rejects.toMatchObject({ code: 'oauth_failed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['nonce', 'audience', 'issuer', 'signature'])('rejects an invalid Google %s', async problem => {
    const { social, auth, fetcher } = setup();
    const flow = await social.start('google', ctx), url = new URL(flow.authorizationUrl);
    let signed = await token(problem === 'nonce' ? 'wrong' : url.searchParams.get('nonce')!, problem === 'audience' ? 'wrong-client' : undefined, problem === 'issuer' ? 'https://evil.example' : undefined);
    if (problem === 'signature') { const parts = signed.split('.'); parts[2] = `AAAA${parts[2]!.slice(4)}`; signed = parts.join('.'); }
    googleResponse(fetcher, signed);
    await expect(social.finish('google', url.searchParams.get('state')!, flow.browser, 'code', ctx)).rejects.toThrow();
    expect(auth.social).not.toHaveBeenCalled();
  });
  it.each(['browser', 'provider', 'cancelled', 'expired'])('rejects %s callbacks before contacting a provider', async problem => {
    const { social, auth, fetcher } = setup();
    const flow = await social.start('google', ctx), state = new URL(flow.authorizationUrl).searchParams.get('state')!;
    if (problem === 'expired') { vi.useFakeTimers(); vi.setSystemTime(Date.now() + 301_000); }
    await expect(social.finish(problem === 'provider' ? 'facebook' : 'google', state, problem === 'browser' ? 'wrong' : flow.browser, problem === 'cancelled' ? undefined : 'code', ctx)).rejects.toMatchObject({ code: 'oauth_failed' });
    expect(fetcher).not.toHaveBeenCalled(); expect(auth.social).not.toHaveBeenCalled();
  });
  it.each([true, false])('validates Facebook token ownership before creating or linking a player (valid=%s)', async valid => {
    const { social, fetcher, auth } = setup();
    const flow = await social.start('facebook', ctx), state = new URL(flow.authorizationUrl).searchParams.get('state')!;
    fetcher.mockResolvedValueOnce(Response.json({ access_token: 'fb-access' }));
    fetcher.mockResolvedValueOnce(Response.json({ id: 'fb-subject', name: 'Tân Binh' }));
    fetcher.mockResolvedValueOnce(Response.json({ data: { is_valid: true, app_id: valid ? 'fb-client' : 'other-app', user_id: 'fb-subject', expires_at: Date.now() / 1000 + 3600 } }));
    if (valid) {
      await social.finish('facebook', state, flow.browser, 'code', ctx);
      expect(auth.social).toHaveBeenCalledWith('facebook', 'fb-subject', 'Tân Binh', ctx, undefined);
    } else { await expect(social.finish('facebook', state, flow.browser, 'code', ctx)).rejects.toThrow(); expect(auth.social).not.toHaveBeenCalled(); }
    expect(fetcher.mock.calls[1]![0]).toContain('appsecret_proof=');
  });
  it('does not start an unconfigured provider', async () => {
    const { kv, auth } = setup();
    const service = new SocialAuth({ ...config, GOOGLE_CLIENT_SECRET: undefined }, kv, auth as unknown as AuthService);
    expect(service.available().google).toBe(false);
    await expect(service.start('google', ctx)).rejects.toMatchObject({ code: 'provider_disabled' });
  });
});

describe('social account sessions', () => {
  function service() {
    const { kv } = setup();
    const account: Account = { id: 'original-id', username: 'Tên Cũ', isGuest: false, passwordHash: null, role: 'player', failedLogins: 0, lockedUntil: null, bannedUntil: null, banReason: null };
    const accounts = { findById: vi.fn(async () => account), social: vi.fn(async () => account), identities: vi.fn(async () => ['google']) };
    const refresh = { create: vi.fn(async () => {}) }, tokens = { signAccess: vi.fn(async () => 'access'), accessTtl: 60 };
    const auth = new AuthService(accounts as unknown as AccountRepository, refresh as unknown as RefreshTokenRepository, tokens as unknown as TokenService, kv, { record: vi.fn() } as unknown as AuditLog, { allowGuest: true, refreshTtlDays: 30 });
    return { auth, accounts, refresh, account };
  }
  it('keeps the old UUID and name when promoting a guest, and issues non-guest claims', async () => {
    const { auth, accounts, refresh } = service();
    const session = await auth.social('google', 'subject', 'New Name', ctx, 'original-id');
    expect(session.account).toMatchObject({ id: 'original-id', username: 'Tên Cũ', guest: false });
    expect(accounts.social).toHaveBeenCalledWith('google', 'subject', expect.any(String), 'original-id');
    expect(refresh.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'original-id' }));
  });
  it('rejects conflicting links and banned accounts without issuing sessions', async () => {
    const { auth, accounts, refresh, account } = service();
    accounts.social.mockResolvedValueOnce(null as unknown as Account);
    await expect(auth.social('google', 'subject', 'Name', ctx, 'original-id')).rejects.toMatchObject({ code: 'identity_taken' });
    account.bannedUntil = new Date(Date.now() + 60_000);
    await expect(auth.social('google', 'subject', 'Name', ctx, 'original-id')).rejects.toMatchObject({ code: 'banned' });
    expect(accounts.social).toHaveBeenCalledTimes(1); expect(refresh.create).not.toHaveBeenCalled();
  });
  it('rejects new password registrations', async () => {
    await expect(service().auth.register('new-user', 'password-long', ctx)).rejects.toMatchObject({ code: 'social_required' });
  });
});
