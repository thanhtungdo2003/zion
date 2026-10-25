import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type GameMode } from '@zion/shared';
import type { HttpDeps } from '../app';

export function registerGameRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const schema = { querystring: { type: 'object', properties: { mode: { type: 'string', enum: ['survival', 'battle-royale', 'infection'] }, map: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' } }, additionalProperties: false } };
  // The battle royale map picker: built-in island plus the maps published from the World Studio.
  if (deps.infectionMapList) app.get('/api/infection/maps', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => { reply.header('cache-control', 'no-store'); return { maps: deps.infectionMapList!() }; });
  if (deps.battleMaps) app.get('/api/battle/maps', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => { reply.header('cache-control', 'no-store'); return { maps: deps.battleMaps!.list() }; });
  if (deps.atlas) app.get<{ Querystring: { mode?: GameMode; map?: string } }>('/api/game/atlas', { schema, preHandler: app.requireAuth, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return deps.atlas!(req.query.mode, req.query.map);
  });
  if (deps.atlasTile) app.get<{ Params: { x: string; z: string }; Querystring: { mode?: GameMode; map?: string } }>('/api/game/atlas/:x/:z', {
    schema,
    preHandler: app.requireAuth,
    config: { rateLimit: { max: 180, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { x, z } = req.params;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(z)) return reply.code(400).send({ error: 'Invalid map tile' });
    try {
      const tile = await deps.atlasTile!(Number(x), Number(z), req.query.mode, req.query.map);
      reply.header('cache-control', 'private, max-age=300');
      return tile;
    } catch (error) {
      if (error instanceof RangeError) return reply.code(400).send({ error: 'Map tile outside world' });
      throw error;
    }
  });
  app.post(
    '/api/game/ticket',
    { preHandler: app.requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { ticket, expiresIn } = await deps.auth.issueTicket(req.claims!);
      reply.header('cache-control', 'no-store');
      return { ticket, expiresIn, wsUrl: deps.config.PUBLIC_WS_URL, protocolVersion: PROTOCOL_VERSION };
    },
  );
}
