import { readFileSync, writeFileSync } from 'node:fs';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import type { ClientEventMap } from 'tiktok-live-connector';

/**
 * Chánh Điện: one TikTok LIVE connection for the studio's temple scene. The studio admin enters
 * a username and connects; every like, chat, follow, share and join is reduced to a small
 * provider-neutral event and handed to the listeners (the SSE stream the scene pages read).
 * Gifts are passed on too, but the scene ignores them (likes, follows and shares make offerings).
 * The graphics settings for the scene live here as well, so the game screen (an OBS browser
 * source, a phone) follows what the admin picks.
 */
export type TempleEventKind = 'join' | 'like' | 'chat' | 'follow' | 'share' | 'gift';
export interface TempleEvent {
  kind: TempleEventKind; id: string; at: number;
  user: { id: string; name: string; avatar: string | null };
  likes?: number; comment?: string; diamonds?: number;
}
export type TempleState = 'idle' | 'connecting' | 'connected' | 'error';
export interface TempleStatus { state: TempleState; username: string | null; roomId: string | null; viewers: number | null; error: string | null }
export interface TempleGraphics {
  renderScale: number; shadows: 'off' | 'low' | 'high'; shaders: boolean; brightness: number; maxPeople: number;
}
export const DEFAULT_TEMPLE_GRAPHICS: TempleGraphics = { renderScale: .8, shadows: 'low', shaders: false, brightness: 1.1, maxPeople: 24 };
export type TempleMessage = { type: 'event'; event: TempleEvent } | { type: 'status'; status: TempleStatus } | { type: 'graphics'; graphics: TempleGraphics };

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? v as Record<string, unknown> : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' || typeof v === 'bigint' ? String(v) : null);
/** v2 users carry avatarThumb/avatarMedium/avatarLarge, each with a urlList of CDN links. */
function avatar(user: Record<string, unknown>): string | null {
  for (const size of ['avatarThumb', 'avatarMedium', 'avatarLarge']) { const list = rec(user[size]).urlList; if (Array.isArray(list) && typeof list[0] === 'string' && /^https:\/\//.test(list[0])) return list[0]; }
  return null;
}
/** Clamps the graphics an admin sends to what the scene supports. */
export function cleanGraphics(input: Partial<TempleGraphics>, base: TempleGraphics = DEFAULT_TEMPLE_GRAPHICS): TempleGraphics {
  const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  return {
    renderScale: num(input.renderScale, .4, 1.5, base.renderScale),
    shadows: input.shadows === 'off' || input.shadows === 'low' || input.shadows === 'high' ? input.shadows : base.shadows,
    shaders: typeof input.shaders === 'boolean' ? input.shaders : base.shaders,
    brightness: num(input.brightness, .5, 2, base.brightness),
    maxPeople: Math.round(num(input.maxPeople, 4, 48, base.maxPeople)),
  };
}

type Connection = TikTokLiveConnection & { on<K extends keyof ClientEventMap>(event: K, listener: ClientEventMap[K]): unknown; removeAllListeners(): unknown };

export class TempleLive {
  private connection: Connection | null = null;
  private readonly listeners = new Set<(m: TempleMessage) => void>();
  private readonly seen = new Set<string>();
  private serial = 0;
  status: TempleStatus = { state: 'idle', username: null, roomId: null, viewers: null, error: null };
  graphics: TempleGraphics;

  constructor(private readonly settingsFile: string | null = null) {
    let saved: Partial<TempleGraphics> = {};
    try { if (settingsFile) saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as Partial<TempleGraphics>; } catch { /* first run: defaults */ }
    this.graphics = cleanGraphics(saved);
  }

  subscribe(fn: (m: TempleMessage) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(m: TempleMessage): void { for (const fn of this.listeners) { try { fn(m); } catch { /* one broken stream never stops the others */ } } }
  private setStatus(patch: Partial<TempleStatus>): void { this.status = { ...this.status, ...patch }; this.emit({ type: 'status', status: this.status }); }

  setGraphics(input: Partial<TempleGraphics>): TempleGraphics {
    this.graphics = cleanGraphics(input, this.graphics);
    try { if (this.settingsFile) writeFileSync(this.settingsFile, JSON.stringify(this.graphics, null, 2)); } catch { /* read-only disk: kept in memory */ }
    this.emit({ type: 'graphics', graphics: this.graphics });
    return this.graphics;
  }

  /** A made-up event from the studio's test buttons (no TikTok needed). */
  inject(kind: TempleEventKind, user: { id: string; name: string }, extra: Pick<TempleEvent, 'likes' | 'comment' | 'diamonds'> = {}): void {
    this.push({ kind, id: `test-${++this.serial}`, at: Date.now(), user: { ...user, avatar: null }, ...extra });
  }

  private push(event: TempleEvent): void {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 20000) this.seen.delete(this.seen.values().next().value as string);
    this.emit({ type: 'event', event });
  }

  async connect(username: string): Promise<TempleStatus> {
    await this.disconnect();
    const name = username.replace(/^@/, '').trim();
    this.setStatus({ state: 'connecting', username: name, roomId: null, viewers: null, error: null });
    const connection = new TikTokLiveConnection(name, { enableExtendedGiftInfo: false }) as Connection;
    this.connection = connection;
    const current = () => this.connection === connection;
    const map = (kind: TempleEventKind) => (payload: unknown) => {
      if (!current()) return;
      const p = rec(payload), user = rec(p.user), common = rec(p.common), id = str(user.id ?? p.userId) ?? str(user.uniqueId);
      if (!id) return;
      const event: TempleEvent = {
        kind, id: str(common.msgId) ?? `${kind}-${id}-${++this.serial}`, at: Date.now(),
        user: { id, name: (str(user.nickname) ?? str(user.displayId) ?? 'Khách').slice(0, 40), avatar: avatar(user) },
      };
      if (kind === 'like') event.likes = Math.max(1, Math.min(1000, Number(p.count) || 1));
      if (kind === 'chat' && typeof p.content === 'string') event.comment = p.content.slice(0, 200);
      if (kind === 'gift') {
        // Only the last message of a combo counts (repeatEnd), as the TikTok app shows it.
        const gift = rec(p.gift);
        if (Number(gift.type) === 1 && !p.repeatEnd) return;
        event.diamonds = (Number(gift.diamondCount) || 0) * Math.max(1, Number(p.repeatCount) || 1);
      }
      this.push(event);
    };
    connection.on(WebcastEvent.MEMBER, map('join'));
    connection.on(WebcastEvent.LIKE, map('like'));
    connection.on(WebcastEvent.CHAT, map('chat'));
    connection.on(WebcastEvent.FOLLOW, map('follow'));
    connection.on(WebcastEvent.SHARE, map('share'));
    connection.on(WebcastEvent.GIFT, map('gift'));
    connection.on(WebcastEvent.ROOM_USER, (payload: unknown) => { const total = Number(rec(payload).total); if (current() && Number.isSafeInteger(total)) this.setStatus({ viewers: total }); });
    connection.on(ControlEvent.DISCONNECTED, () => { if (current()) this.setStatus({ state: 'error', error: 'Mất kết nối với TikTok LIVE.' }); });
    connection.on(WebcastEvent.STREAM_END, () => { if (current()) this.setStatus({ state: 'idle', error: 'Buổi LIVE đã kết thúc.' }); });
    try {
      const state = await connection.connect();
      if (!current()) return this.status;
      this.setStatus({ state: 'connected', roomId: str(state.roomId) });
    } catch (error) {
      if (current()) { this.connection = null; this.setStatus({ state: 'error', error: friendlyError(error) }); }
    }
    return this.status;
  }

  async disconnect(): Promise<void> {
    const c = this.connection; this.connection = null;
    if (c) { try { await c.disconnect(); } catch { /* already closed */ } finally { c.removeAllListeners(); } }
    if (this.status.state !== 'idle') this.setStatus({ state: 'idle', roomId: null, viewers: null });
  }
}

function friendlyError(error: unknown): string {
  const text = String(rec(error).message ?? error);
  if (/offline|not.*live|LIVE has ended|isn't online/i.test(text)) return 'Tài khoản này đang không LIVE.';
  if (/sign|rate.?limit|429/i.test(text)) return 'Máy chủ ký của TikTok đang từ chối, thử lại sau ít phút.';
  if (/user.*not.*found|unique/i.test(text)) return 'Không tìm thấy tài khoản TikTok này.';
  return 'Không kết nối được TikTok LIVE.';
}
