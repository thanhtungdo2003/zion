import { isIP } from 'node:net';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';

export type AuditSeverity = 'info' | 'warn' | 'critical';

export interface AuditEvent {
  event: string;
  accountId?: string | null;
  ip?: string | null;
  severity?: AuditSeverity;
  details?: Record<string, unknown>;
}

const MAX_QUEUE = 10_000;
const FLUSH_BATCH = 500;

/**
 * Append-only audit trail for security-relevant events. Writes are queued and flushed in batches
 * so that bursts (e.g. a credential-stuffing attack) cannot stall request handling. If the queue
 * overflows, events are dropped with an error log rather than growing memory without bound.
 */
export class AuditLog {
  private queue: AuditEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private dropped = 0;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    flushIntervalMs = 1000,
  ) {
    this.timer = setInterval(() => void this.flush(), flushIntervalMs);
    this.timer.unref();
  }

  record(e: AuditEvent): void {
    const severity = e.severity ?? 'info';
    this.logger[severity === 'info' ? 'info' : 'warn']({ audit: e.event, accountId: e.accountId, ip: e.ip, ...e.details }, 'audit');
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      if (this.dropped % 1000 === 1) this.logger.error({ dropped: this.dropped }, 'audit queue overflow');
      return;
    }
    this.queue.push({ ...e, severity, ip: e.ip && isIP(e.ip) ? e.ip : null });
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, FLUSH_BATCH);
    this.flushing = this.db
      .query(
        `INSERT INTO audit_log (event, account_id, severity, ip, details)
         SELECT e, a, s, i::inet, d::jsonb
           FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::text[]) AS t(e, a, s, i, d)`,
        [
          batch.map((b) => b.event.slice(0, 64)),
          batch.map((b) => b.accountId ?? null),
          batch.map((b) => b.severity ?? 'info'),
          batch.map((b) => b.ip ?? null),
          batch.map((b) => JSON.stringify(b.details ?? {}).slice(0, 8000)),
        ],
      )
      .then(() => undefined)
      .catch((err: unknown) => {
        this.logger.error({ err, count: batch.length }, 'failed to persist audit events');
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.queue.length > 0) await this.flush();
    if (this.flushing) await this.flushing;
  }
}
