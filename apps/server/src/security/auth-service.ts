import { randomUUID } from 'node:crypto';
import type { KeyValueStore } from '../infra/kv';
import type { Account, AccountRepository, SocialProvider } from '../repositories/accounts';
import type { AuditLog } from '../repositories/audit';
import type { RefreshTokenRepository } from '../repositories/refresh-tokens';
import { getDummyHash, verifyPassword } from './password';
import { randomToken, sha256, type AccessClaims, type TokenService } from './tokens';

export interface RequestContext {
  ip: string;
  userAgent: string | null;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  account: { id: string; username: string; guest: boolean; role: Account['role'] };
}

export type AuthErrorCode = 'invalid_credentials' | 'username_taken' | 'locked' | 'banned' | 'invalid_token' | 'guest_disabled' | 'social_required' | 'provider_disabled' | 'oauth_failed' | 'identity_taken';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface TicketPayload {
  accountId: string;
  username: string;
  role: Account['role'];
  guest: boolean;
}

const LOCK_THRESHOLD = 8;
const LOCK_SECONDS = 15 * 60;
const TICKET_TTL_SEC = 30;

export class AuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly kv: KeyValueStore,
    private readonly audit: AuditLog,
    private readonly opts: { refreshTtlDays: number; allowGuest: boolean },
  ) {}

  get refreshTtlSec(): number {
    return this.opts.refreshTtlDays * 86400;
  }

  private assertNotBanned(acc: Account, ctx: RequestContext): void {
    if (acc.bannedUntil && acc.bannedUntil.getTime() > Date.now()) {
      this.audit.record({ event: 'auth.banned_attempt', accountId: acc.id, ip: ctx.ip, severity: 'warn' });
      throw new AuthError('banned', 403, 'account is banned');
    }
  }

  private async issueSession(acc: Account, ctx: RequestContext, familyId: string = randomUUID()): Promise<Session> {
    const refreshToken = randomToken();
    await this.refreshTokens.create({
      accountId: acc.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
      userAgent: ctx.userAgent?.slice(0, 256) ?? null,
      ip: ctx.ip,
    });
    return {
      accessToken: await this.tokens.signAccess(this.claims(acc)),
      expiresIn: this.tokens.accessTtl,
      refreshToken,
      account: { id: acc.id, username: acc.username, guest: acc.isGuest, role: acc.role },
    };
  }

  private claims(acc: Account): AccessClaims {
    return { sub: acc.id, name: acc.username, role: acc.role, guest: acc.isGuest };
  }

  async register(_username: string, _password: string, _ctx: RequestContext): Promise<Session> {
    throw new AuthError('social_required', 403, 'Tài khoản mới cần đăng nhập bằng Google hoặc Facebook.');
  }

  async linkedProviders(id: string): Promise<SocialProvider[]> {
    return this.accounts.identities(id);
  }

  /** A fresh session for an account that proved itself elsewhere (the desktop app's browser sign-in). */
  async sessionFor(id: string, ctx: RequestContext): Promise<Session> {
    const acc = await this.accounts.findById(id);
    if (!acc) throw new AuthError('invalid_token', 401, 'account no longer exists');
    this.assertNotBanned(acc, ctx);
    this.audit.record({ event: 'auth.desktop_login', accountId: acc.id, ip: ctx.ip });
    return this.issueSession(acc, ctx);
  }

  async checkAccount(id: string, ctx: RequestContext): Promise<void> {
    const acc = await this.accounts.findById(id);
    if (!acc) throw new AuthError('invalid_token', 401, 'account no longer exists');
    this.assertNotBanned(acc, ctx);
  }

  async social(provider: SocialProvider, subject: string, name: string, ctx: RequestContext, accountId?: string): Promise<Session> {
    if (accountId) await this.checkAccount(accountId, ctx);
    const prefix = name.normalize('NFC').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 10) || 'Survivor';
    const acc = await this.accounts.social(provider, subject, `${prefix}_${randomToken().slice(0, 8)}`, accountId);
    if (!acc) throw new AuthError('identity_taken', 409, 'Tài khoản mạng xã hội này đã được liên kết hoặc nhà cung cấp đã có liên kết khác.');
    this.assertNotBanned(acc, ctx);
    this.audit.record({ event: accountId ? 'account.social_link' : 'auth.social_login', accountId: acc.id, ip: ctx.ip, details: { provider } });
    return this.issueSession(acc, ctx);
  }

  async login(username: string, password: string, ctx: RequestContext): Promise<Session> {
    const acc = await this.accounts.findByUsername(username);
    if (!acc || !acc.passwordHash) {
      // Burn equivalent CPU so response timing does not reveal whether the account exists.
      await verifyPassword(password, await getDummyHash());
      this.audit.record({ event: 'auth.login_failed', ip: ctx.ip, severity: 'warn', details: { reason: 'unknown_user' } });
      throw new AuthError('invalid_credentials', 401, 'invalid username or password');
    }
    if (acc.lockedUntil && acc.lockedUntil.getTime() > Date.now()) {
      this.audit.record({ event: 'auth.login_locked', accountId: acc.id, ip: ctx.ip, severity: 'warn' });
      throw new AuthError('locked', 429, 'too many failed attempts, try again later');
    }
    if (!(await verifyPassword(password, acc.passwordHash))) {
      const { locked } = await this.accounts.recordLoginFailure(acc.id, LOCK_THRESHOLD, LOCK_SECONDS);
      this.audit.record({
        event: locked ? 'account.locked' : 'auth.login_failed',
        accountId: acc.id,
        ip: ctx.ip,
        severity: locked ? 'critical' : 'warn',
      });
      throw new AuthError('invalid_credentials', 401, 'invalid username or password');
    }
    this.assertNotBanned(acc, ctx);
    await this.accounts.recordLoginSuccess(acc.id);
    this.audit.record({ event: 'auth.login', accountId: acc.id, ip: ctx.ip });
    return this.issueSession(acc, ctx);
  }

  async guest(ctx: RequestContext, username: string): Promise<Session> {
    if (!this.opts.allowGuest) throw new AuthError('guest_disabled', 403, 'guest access is disabled');
    const acc = await this.accounts.create(username, null, true);
    if (!acc) throw new AuthError('username_taken', 409, 'username is already taken');
    this.audit.record({ event: 'account.guest', accountId: acc.id, ip: ctx.ip });
    return this.issueSession(acc, ctx);
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<Session> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) throw new AuthError('invalid_token', 401, 'invalid refresh token');
    const next = randomToken();
    const res = await this.refreshTokens.rotate({
      tokenHash: sha256(refreshToken),
      newTokenHash: sha256(next),
      expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
      userAgent: ctx.userAgent?.slice(0, 256) ?? null,
      ip: ctx.ip,
    });
    if (res.status === 'reused') {
      this.audit.record({
        event: 'auth.refresh_reuse_detected',
        accountId: res.accountId,
        ip: ctx.ip,
        severity: 'critical',
        details: { familyId: res.familyId },
      });
      throw new AuthError('invalid_token', 401, 'refresh token reuse detected; session revoked');
    }
    if (res.status !== 'ok') throw new AuthError('invalid_token', 401, 'invalid or expired refresh token');
    const acc = await this.accounts.findById(res.accountId);
    if (!acc) throw new AuthError('invalid_token', 401, 'account no longer exists');
    this.assertNotBanned(acc, ctx);
    return {
      accessToken: await this.tokens.signAccess(this.claims(acc)),
      expiresIn: this.tokens.accessTtl,
      refreshToken: next,
      account: { id: acc.id, username: acc.username, guest: acc.isGuest, role: acc.role },
    };
  }

  /** Renames an account; the new access token carries the new name (the refresh token is unchanged). */
  async rename(accountId: string, username: string, ctx: RequestContext): Promise<Omit<Session, 'refreshToken'>> {
    const current = await this.accounts.findById(accountId);
    if (!current) throw new AuthError('invalid_token', 401, 'account no longer exists');
    this.assertNotBanned(current, ctx);
    const acc = current.username === username ? current : await this.accounts.rename(accountId, username);
    if (!acc) throw new AuthError('username_taken', 409, 'Tên này đã có người dùng.');
    this.audit.record({ event: 'account.rename', accountId, ip: ctx.ip, details: { from: current.username, to: username } });
    return {
      accessToken: await this.tokens.signAccess(this.claims(acc)),
      expiresIn: this.tokens.accessTtl,
      account: { id: acc.id, username: acc.username, guest: acc.isGuest, role: acc.role },
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken && /^[A-Za-z0-9_-]{43}$/.test(refreshToken)) await this.refreshTokens.revokeByHash(sha256(refreshToken));
  }

  /** Issues a single-use, 30-second WebSocket ticket (keeps long-lived tokens out of WS URLs/logs). */
  async issueTicket(claims: AccessClaims): Promise<{ ticket: string; expiresIn: number }> {
    const acc = await this.accounts.findById(claims.sub);
    if (!acc) throw new AuthError('invalid_token', 401, 'account no longer exists');
    if (acc.bannedUntil && acc.bannedUntil.getTime() > Date.now()) throw new AuthError('banned', 403, 'account is banned');
    const ticket = randomToken();
    const payload: TicketPayload = { accountId: acc.id, username: acc.username, role: acc.role, guest: acc.isGuest };
    const stored = await this.kv.putIfAbsent(`wst:${ticket}`, JSON.stringify(payload), TICKET_TTL_SEC);
    if (!stored) throw new Error('ticket collision');
    return { ticket, expiresIn: TICKET_TTL_SEC };
  }

  async consumeTicket(ticket: string): Promise<TicketPayload | null> {
    const raw = await this.kv.take(`wst:${ticket}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TicketPayload;
    } catch {
      return null;
    }
  }
}
