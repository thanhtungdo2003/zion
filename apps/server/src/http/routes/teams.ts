import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpDeps } from '../app';
import { TeamError } from '../../game/teams';
import { sanitizeChat } from '../../game/anticheat';

const name = z.string().trim().min(3).max(32);
const actionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), name, public: z.boolean() }).strict(),
  z.object({ op: z.literal('join'), code: z.string().trim().regex(/^[a-fA-F0-9]{8}$/) }).strict(),
  z.object({ op: z.literal('joinPublic'), id: z.string().uuid() }).strict(),
  z.object({ op: z.literal('leave') }).strict(),
  z.object({ op: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ op: z.literal('kick'), accountId: z.string().uuid() }).strict(),
  z.object({ op: z.literal('promote'), accountId: z.string().uuid() }).strict(),
  z.object({ op: z.literal('settings'), name, public: z.boolean() }).strict(),
  z.object({ op: z.literal('launch') }).strict(),
  z.object({ op: z.literal('chat'), text: z.string().trim().min(1).max(200).transform(sanitizeChat).refine((text) => text.length > 0) }).strict(),
]);

export function registerTeamRoutes(app: FastifyInstance, deps: HttpDeps): void {
  const teams = deps.teams;
  if (!teams) return;
  app.get('/api/teams', { preHandler: app.requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const lobby = teams.lobby(req.claims!.sub);
    return deps.progression ? deps.progression.lobbyRanks(lobby) : lobby;
  });
  app.post('/api/teams', { preHandler: app.requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const action = actionSchema.parse(req.body);
    try {
      const lobby = await teams.action(req.claims!.sub, req.claims!.name, action, await deps.progression?.title(req.claims!.sub));
      return deps.progression ? deps.progression.lobbyRanks(lobby) : lobby;
    }
    catch (err) { if (err instanceof TeamError) return reply.code(err.status).send({ error: 'team_error', message: err.message }); throw err; }
  });
}
