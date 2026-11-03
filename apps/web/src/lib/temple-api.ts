import { API_URL, studioJson } from './api';
import type { TempleGraphics, TempleStatus } from '@/game/temple/scene';
import type { TempleEventInput } from '@/game/temple/simulation';

/** Chánh Điện: the server's TikTok connection, test events and the scene's graphics. */
export type TempleMessage = { type: 'event'; event: TempleEventInput } | { type: 'status'; status: TempleStatus } | { type: 'graphics'; graphics: TempleGraphics };

/** Listens to the public event stream (reconnects by itself); returns the stop function. */
export function templeStream(on: (m: TempleMessage) => void, online?: (up: boolean) => void): () => void {
  const source = new EventSource(`${API_URL}/api/temple/events`);
  source.onmessage = (e) => { try { on(JSON.parse(e.data as string) as TempleMessage); } catch { /* skip a malformed message */ } };
  source.onopen = () => online?.(true);
  source.onerror = () => online?.(false);
  return () => source.close();
}
const post = <T>(path: string, body: unknown) => studioJson<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const templeConnect = (username: string) => post<{ status: TempleStatus }>('/api/studio/temple/connect', { username });
export const templeDisconnect = () => post<{ status: TempleStatus }>('/api/studio/temple/disconnect', {});
export const templeSaveGraphics = (g: Partial<TempleGraphics>) => post<{ graphics: TempleGraphics }>('/api/studio/temple/graphics', g);
export const templeTest = (kind: 'like' | 'chat' | 'follow' | 'share', extra: { likes?: number; name?: string; comment?: string } = {}) => post<{ ok: true }>('/api/studio/temple/test', { kind, ...extra });
