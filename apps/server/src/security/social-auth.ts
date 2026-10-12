import { createHmac } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { KeyValueStore } from '../infra/kv';
import type { SocialProvider } from '../repositories/accounts';
import { AuthError, type AuthService, type RequestContext } from './auth-service';
import { randomToken, sha256 } from './tokens';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const graph = 'https://graph.facebook.com/v23.0';
const stateSchema = z.object({ provider: z.enum(['google', 'facebook']), browserHash: z.string(), verifier: z.string(), nonce: z.string(), accountId: z.string().optional() });
const failed = () => new AuthError('oauth_failed', 400, 'Đăng nhập chưa hoàn tất. Vui lòng thử lại.');

export class SocialAuth {
  constructor(private readonly config: AppConfig, private readonly kv: KeyValueStore, private readonly auth: AuthService, private readonly fetcher: typeof fetch = fetch, private readonly googleKeySet: JWTVerifyGetKey = googleKeys) {}

  available(): Record<SocialProvider, boolean> {
    return { google: !!(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET), facebook: !!(this.config.FACEBOOK_APP_ID && this.config.FACEBOOK_APP_SECRET) };
  }

  private credentials(provider: SocialProvider) {
    if (!this.available()[provider]) throw new AuthError('provider_disabled', 503, `${provider === 'google' ? 'Google' : 'Facebook'} chưa được cấu hình trên máy chủ.`);
    return provider === 'google'
      ? { id: this.config.GOOGLE_CLIENT_ID!, secret: this.config.GOOGLE_CLIENT_SECRET! }
      : { id: this.config.FACEBOOK_APP_ID!, secret: this.config.FACEBOOK_APP_SECRET! };
  }

  private callback(provider: SocialProvider): string {
    return `${this.config.PUBLIC_API_URL.replace(/\/$/, '')}/api/auth/oauth/${provider}/callback`;
  }

  async start(provider: SocialProvider, ctx: RequestContext, accountId?: string) {
    const credentials = this.credentials(provider);
    if (accountId) await this.auth.checkAccount(accountId, ctx);
    const state = randomToken(), browser = randomToken(), verifier = randomToken(), nonce = randomToken();
    if (!await this.kv.putIfAbsent(`oauth:${state}`, JSON.stringify({ provider, browserHash: sha256(browser).toString('hex'), verifier, nonce, accountId }), 300)) throw failed();
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://www.facebook.com/v23.0/dialog/oauth');
    url.search = new URLSearchParams({ client_id: credentials.id, redirect_uri: this.callback(provider), response_type: 'code', state, scope: provider === 'google' ? 'openid profile' : 'public_profile' }).toString();
    if (provider === 'google') {
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', sha256(verifier).toString('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('prompt', 'select_account');
    } else url.searchParams.set('auth_type', 'reauthenticate');
    return { authorizationUrl: url.toString(), browser };
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw failed();
    return response.json();
  }

  async finish(provider: SocialProvider, state: string, browser: string | undefined, code: string | undefined, ctx: RequestContext) {
    if (!/^[\w-]{43}$/.test(state) || !browser) throw failed();
    const raw = await this.kv.take(`oauth:${state}`);
    if (!raw) throw failed();
    const saved = stateSchema.parse(JSON.parse(raw));
    if (saved.provider !== provider || saved.browserHash !== sha256(browser).toString('hex') || !code) throw failed();
    const credentials = this.credentials(provider);
    const token = z.object({ access_token: z.string().min(1), id_token: z.string().optional() }).parse(await this.json(provider === 'google' ? 'https://oauth2.googleapis.com/token' : `${graph}/oauth/access_token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, code, redirect_uri: this.callback(provider), grant_type: 'authorization_code', ...(provider === 'google' ? { code_verifier: saved.verifier } : {}) }).toString(),
    }));
    let subject: string, name: string;
    if (provider === 'google') {
      if (!token.id_token) throw failed();
      const { payload } = await jwtVerify(token.id_token, this.googleKeySet, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: credentials.id, algorithms: ['RS256'] });
      if (!payload.sub || payload.nonce !== saved.nonce || (payload.azp && payload.azp !== credentials.id)) throw failed();
      subject = payload.sub; name = typeof payload.name === 'string' ? payload.name : 'Survivor';
    } else {
      const proof = createHmac('sha256', credentials.secret).update(token.access_token).digest('hex');
      const profileUrl = new URL(`${graph}/me`); profileUrl.search = new URLSearchParams({ fields: 'id,name', appsecret_proof: proof }).toString();
      const profile = z.object({ id: z.string().min(1).max(255), name: z.string() }).parse(await this.json(profileUrl.toString(), { headers: { authorization: `Bearer ${token.access_token}` } }));
      const debugUrl = new URL(`${graph}/debug_token`); debugUrl.searchParams.set('input_token', token.access_token);
      const debug = z.object({ data: z.object({ is_valid: z.boolean(), app_id: z.string(), user_id: z.string(), expires_at: z.number() }) }).parse(await this.json(debugUrl.toString(), { headers: { authorization: `Bearer ${credentials.id}|${credentials.secret}` } }));
      if (!debug.data.is_valid || debug.data.app_id !== credentials.id || debug.data.user_id !== profile.id || debug.data.expires_at <= Date.now() / 1000) throw failed();
      subject = profile.id; name = profile.name;
    }
    if (subject.length > 255) throw failed();
    return this.auth.social(provider, subject, name, ctx, saved.accountId);
  }
}
