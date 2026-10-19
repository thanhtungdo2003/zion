import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { sanitizeChat } from '../../game/anticheat';

/** One line of the server-wide chat (the main menu's world channel). */
export interface WorldChatLine { id: number; at: number; accountId: string; name: string; text: string }

const KEEP = 120;
const GAP_MS = 2500;

/** The world channel: the latest lines in memory, polled by every main menu. */
export class WorldChat {
  private readonly lines: WorldChatLine[] = [];
  private readonly lastAt = new Map<string, number>();
  private next = 1;

  /** Lines after `after` (all kept lines when 0). */
  since(after: number): WorldChatLine[] { return this.lines.filter((l) => l.id > after); }
  get latest(): number { return this.next - 1; }

  /** Adds a line; null while the sender must still wait (one line per 2.5 s). */
  post(accountId: string, name: string, text: string, now = Date.now()): WorldChatLine | null {
    if (now - (this.lastAt.get(accountId) ?? -Infinity) < GAP_MS) return null;
    this.lastAt.set(accountId, now);
    const line = { id: this.next++, at: now, accountId, name, text };
    this.lines.push(line);
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    return line;
  }
}

const postSchema = z.object({ text: z.string().trim().min(1).max(160).transform(sanitizeChat).refine((t) => t.length > 0) }).strict();

export function registerWorldChatRoutes(app: FastifyInstance, _deps: HttpDeps, chat = new WorldChat()): void {
  app.get('/api/chat', { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } }, async (req, reply) => {
    const after = Math.max(0, Number((req.query as { after?: string } | undefined)?.after) || 0);
    reply.header('cache-control', 'no-store');
    return { latest: chat.latest, lines: chat.since(after).map(({ accountId: _a, ...line }) => line) };
  });
  app.post('/api/chat', { preHandler: app.requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { text } = postSchema.parse(req.body);
    const line = chat.post(req.claims!.sub, req.claims!.name, text);
    if (!line) return reply.code(429).send({ error: 'slow_down', message: 'Bạn gửi quá nhanh, đợi vài giây.' });
    const { accountId: _a, ...out } = line;
    return out;
  });
}
