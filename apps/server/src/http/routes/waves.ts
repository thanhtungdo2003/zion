import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WAVE_BOARDS, type WaveBoard, type WaveLeaderboard } from '@zion/shared';
import type { HttpDeps } from '../app';

/** Zombie Wave Survival: playable maps and the per-map, per-board leaderboards. */
export function registerWaveRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const waves = deps.waves;
  if (!waves) return;
  app.get('/api/waves/maps', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { maps: waves.maps() };
  });
  app.get('/api/waves/leaderboard', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z.object({ map: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), board: z.enum(WAVE_BOARDS.map((b) => b.id) as [WaveBoard, ...WaveBoard[]]) }).strict().parse(req.query);
    if (!waves.maps().some((m) => m.id === q.map)) return reply.code(404).send({ error: 'not_found', message: 'Bản đồ không hỗ trợ chế độ sinh tồn theo đợt.' });
    reply.header('cache-control', 'no-store');
    return waves.leaderboard(q.map, q.board);
  });
}

export interface WaveBackend {
  maps(): Array<{ id: string; name: string; thumbnail: string | null; players: number }>;
  leaderboard(mapId: string, board: WaveBoard): Promise<WaveLeaderboard>;
}
