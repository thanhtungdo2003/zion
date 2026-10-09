import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export interface HealthReport {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

export interface HealthProvider {
  ready(): Promise<HealthReport>;
  /** Prometheus text exposition. */
  metrics(): string;
}

export function registerHealthRoutes(app: FastifyInstance, health: HealthProvider, metricsToken?: string): void {
  // Liveness: the process is up and the event loop responds.
  app.get('/health/live', { logLevel: 'warn' }, async () => ({ ok: true }));

  // Readiness: dependencies reachable and the world generator initialised.
  app.get('/health/ready', { logLevel: 'warn' }, async (_req, reply) => {
    const report = await health.ready();
    return reply.code(report.ok ? 200 : 503).send(report);
  });

  app.get('/metrics', { logLevel: 'warn' }, async (req, reply) => {
    if (!metricsToken) return reply.code(404).send({ error: 'not_found', message: 'not found' });
    const got = Buffer.from(req.headers.authorization ?? '');
    const want = Buffer.from(`Bearer ${metricsToken}`);
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'unauthorized' });
    }
    return reply.type('text/plain; version=0.0.4').send(health.metrics());
  });
}
