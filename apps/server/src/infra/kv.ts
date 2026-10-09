import { Redis } from 'ioredis';
import type { Logger } from '../logger';

/**
 * Minimal key/value contract for short-lived security tokens (single-use WebSocket tickets).
 * Redis is used when configured (required for multi-instance deployments); otherwise an in-memory
 * store with expiry and a hard size cap keeps single-node development self-contained.
 */
export interface KeyValueStore {
  readonly kind: 'redis' | 'memory';
  /** Stores value if the key does not exist. Returns false if it already existed. */
  putIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean>;
  /** Atomically reads and deletes a key (single use). */
  take(key: string): Promise<string | null>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  /** Underlying Redis client, when available (shared by the HTTP rate limiter). */
  readonly redis: Redis | null;
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  readonly redis = null;
  private readonly map = new Map<string, { value: string; expires: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly maxEntries = 100_000) {
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expires <= now) this.map.delete(k);
  }

  putIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    const cur = this.map.get(key);
    if (cur && cur.expires > now) return Promise.resolve(false);
    if (this.map.size >= this.maxEntries) {
      this.sweep();
      if (this.map.size >= this.maxEntries) return Promise.reject(new Error('kv store full'));
    }
    this.map.set(key, { value, expires: now + ttlSec * 1000 });
    return Promise.resolve(true);
  }

  take(key: string): Promise<string | null> {
    const cur = this.map.get(key);
    this.map.delete(key);
    return Promise.resolve(cur && cur.expires > Date.now() ? cur.value : null);
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    clearInterval(this.sweeper);
    this.map.clear();
    return Promise.resolve();
  }
}

export class RedisKeyValueStore implements KeyValueStore {
  readonly kind = 'redis' as const;

  constructor(readonly redis: Redis) {}

  async putIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean> {
    return (await this.redis.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }

  async take(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export async function createKeyValueStore(url: string | undefined, logger: Logger): Promise<KeyValueStore> {
  if (!url) {
    logger.warn('REDIS_URL not set: using in-memory store (single instance only)');
    return new MemoryKeyValueStore();
  }
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  });
  redis.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
  await redis.connect();
  return new RedisKeyValueStore(redis);
}
